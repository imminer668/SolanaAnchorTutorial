import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import { MemeCoin } from "../target/types/meme_coin";
import { assert } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  getMint,
  mintTo,
} from "@solana/spl-token";

describe("meme-coin", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.memeCoin as Program<MemeCoin>;
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  const TOTAL_SUPPLY = 1_000_000_000_000_000n; // 1,000,000 token, 9 decimals
  const TEAM_AMOUNT = 200_000_000_000_000n; // 200,000 token
  const COMMUNITY_AMOUNT = 800_000_000_000_000n; // 800,000 token

  let mint: Keypair;
  let teamWallet: Keypair;
  let communityWallet: Keypair;
  let teamAta: PublicKey;
  let communityAta: PublicKey;
  let configPda: PublicKey;

  before(async () => {
    mint = Keypair.generate();
    teamWallet = Keypair.generate();
    communityWallet = Keypair.generate();

    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("meme"), mint.publicKey.toBuffer()],
      program.programId
    );

    teamAta = getAssociatedTokenAddressSync(
      mint.publicKey,
      teamWallet.publicKey
    );
    communityAta = getAssociatedTokenAddressSync(
      mint.publicKey,
      communityWallet.publicKey
    );
  });

  function deriveAta(mint: PublicKey, owner: PublicKey) {
    return getAssociatedTokenAddressSync(mint, owner);
  }

  it("creates mint and distributes total supply to team + community", async () => {
    await program.methods
      .initialize(
        new anchor.BN(TOTAL_SUPPLY.toString()),
        new anchor.BN(TEAM_AMOUNT.toString()),
        new anchor.BN(COMMUNITY_AMOUNT.toString())
      )
      .accounts({
        config: configPda,
        mint: mint.publicKey,
        teamAta: deriveAta(mint.publicKey, teamWallet.publicKey),
        communityAta: deriveAta(mint.publicKey, communityWallet.publicKey),
        teamWallet: teamWallet.publicKey,
        communityWallet: communityWallet.publicKey,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([mint])
      .rpc();

    // 验证 mint 状态
    const mintInfo = await getMint(connection, mint.publicKey);
    assert.strictEqual(mintInfo.supply, TOTAL_SUPPLY);
    assert.strictEqual(mintInfo.decimals, 9);
    assert.ok(mintInfo.mintAuthority.equals(configPda));

    // 验证 config 状态
    const config = await program.account.memeCoinConfig.fetch(configPda);
    assert.ok(config.authority.equals(wallet.publicKey));
    assert.strictEqual(config.totalSupply.toString(), TOTAL_SUPPLY.toString());
    assert.strictEqual(config.teamAmount.toString(), TEAM_AMOUNT.toString());
    assert.strictEqual(
      config.communityAmount.toString(),
      COMMUNITY_AMOUNT.toString()
    );
    assert.isFalse(config.locked);

    // 验证 team 余额
    const teamAccount = await getAccount(connection, teamAta);
    assert.strictEqual(teamAccount.amount, TEAM_AMOUNT);

    // 验证 community 余额
    const communityAccount = await getAccount(connection, communityAta);
    assert.strictEqual(communityAccount.amount, COMMUNITY_AMOUNT);
  });

  it("rejects amount mismatch (team + community != total_supply)", async () => {
    const newMint = Keypair.generate();
    const [newConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("meme"), newMint.publicKey.toBuffer()],
      program.programId
    );

    const teamKp = Keypair.generate();
    const communityKp = Keypair.generate();

    try {
      await program.methods
        .initialize(
          new anchor.BN(TOTAL_SUPPLY.toString()),
          new anchor.BN(TEAM_AMOUNT.toString()),
          new anchor.BN(1_000n.toString()) // 故意让 team + community != total
        )
        .accounts({
          config: newConfig,
          mint: newMint.publicKey,
          teamAta: deriveAta(newMint.publicKey, teamKp.publicKey),
          communityAta: deriveAta(newMint.publicKey, communityKp.publicKey),
          teamWallet: teamKp.publicKey,
          communityWallet: communityKp.publicKey,
          authority: wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([newMint])
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      assert.instanceOf(err, AnchorError);
      const anchorErr = err as AnchorError;
      assert.strictEqual(anchorErr.error.errorCode.code, "AmountMismatch");
    }
  });

  it("non-mint-authority cannot mint more tokens", async () => {
    // 模拟"非 mint authority 增发"
    // mint 的 mint authority 是 config PDA，普通用户没有 PDA 的私钥
    const randomUser = Keypair.generate();
    const sig = await connection.requestAirdrop(
      randomUser.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig);

    let threw = false;
    try {
      // 试图用 randomUser 增发到自己的 ATA
      const randomAta = deriveAta(mint.publicKey, randomUser.publicKey);
      // 先确保 ATA 存在
      const createAtaIx =
        anchor.utils.token.associatedAddress?.associatedAddress ?? null;
      // 用 spl-token helper
      const { createAssociatedTokenAccountInstruction } = await import(
        "@solana/spl-token"
      );
      const tx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          randomAta,
          randomUser.publicKey,
          mint.publicKey
        )
      );
      await provider.sendAndConfirm(tx);

      // randomUser 试图 mint 给自己 - 应当失败
      await mintTo(
        connection,
        randomUser, // 错的 mint authority
        mint.publicKey,
        randomAta,
        randomUser, // 错的 mint authority
        1_000_000_000n
      );
    } catch (e) {
      threw = true;
    }
    assert.isTrue(threw, "non-mint-authority mint should fail");
  });

  it("locks the mint to make supply permanent", async () => {
    await program.methods
      .lockMint()
      .accounts({
        config: configPda,
        mint: mint.publicKey,
        authority: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // 验证 mint authority 已经为 None
    const mintInfo = await getMint(connection, mint.publicKey);
    assert.strictEqual(mintInfo.mintAuthority, null);

    // 验证 config.locked == true
    const config = await program.account.memeCoinConfig.fetch(configPda);
    assert.isTrue(config.locked);
  });

  it("cannot lock twice", async () => {
    try {
      await program.methods
        .lockMint()
        .accounts({
          config: configPda,
          mint: mint.publicKey,
          authority: wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      assert.instanceOf(err, AnchorError);
      const anchorErr = err as AnchorError;
      assert.strictEqual(anchorErr.error.errorCode.code, "AlreadyLocked");
    }
  });
});
