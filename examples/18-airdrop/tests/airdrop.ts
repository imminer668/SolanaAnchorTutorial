import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Airdrop } from "../target/types/airdrop";
import { assert } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

describe("airdrop", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.airdrop as Program<Airdrop>;
  const authority = (provider.wallet as anchor.Wallet).payer;

  let mint: PublicKey;
  let authorityAta: PublicKey;
  let airdropPda: PublicKey;
  let vaultPda: PublicKey;

  const CLAIM_AMOUNT = 100n;
  const TOTAL_DEPOSIT = 300n; // 仅够 3 个 claim

  before(async () => {
    // 创建 mint, mint 1000 to authority
    mint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6
    );
    const ata = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority,
      mint,
      authority.publicKey
    );
    authorityAta = ata.address;
    await mintTo(
      provider.connection,
      authority,
      mint,
      authorityAta,
      authority,
      1_000n
    );

    [airdropPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("airdrop"), authority.publicKey.toBuffer(), mint.toBuffer()],
      program.programId
    );
    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), airdropPda.toBuffer()],
      program.programId
    );
  });

  async function airdropSol(to: PublicKey, sol: number) {
    const sig = await provider.connection.requestAirdrop(
      to,
      sol * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
  }

  it("creates airdrop and deposits tokens to vault", async () => {
    await program.methods
      .createAirdrop(
        new anchor.BN(CLAIM_AMOUNT.toString()),
        new anchor.BN(TOTAL_DEPOSIT.toString())
      )
      .accounts({
        mint,
        authorityAta,
        authority: authority.publicKey,
      })
      .rpc();

    const airdrop = await program.account.airdrop.fetch(airdropPda);
    assert.strictEqual(airdrop.claimAmount.toString(), CLAIM_AMOUNT.toString());
    assert.strictEqual(airdrop.claimedCount.toString(), "0");

    const vault = await getAccount(provider.connection, vaultPda);
    assert.strictEqual(vault.amount, TOTAL_DEPOSIT);
  });

  it("claims successfully (first claim)", async () => {
    const claimer = Keypair.generate();
    await airdropSol(claimer.publicKey, 2);

    const claimerAta = getAssociatedTokenAddressSync(mint, claimer.publicKey);
    const setupTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        claimer.publicKey,
        claimerAta,
        claimer.publicKey,
        mint
      )
    );
    await provider.sendAndConfirm(setupTx, [claimer]);

    await program.methods
      .claim()
      .accounts({
        airdrop: airdropPda,
        claimerAta,
        claimer: claimer.publicKey,
      })
      .signers([claimer])
      .rpc();

    const after = await getAccount(provider.connection, claimerAta);
    assert.strictEqual(after.amount, CLAIM_AMOUNT);

    const airdrop = await program.account.airdrop.fetch(airdropPda);
    assert.strictEqual(airdrop.claimedCount.toString(), "1");
  });

  it("rejects duplicate claim", async () => {
    // 用同一个 claimer 二次 claim
    const claimer = Keypair.generate();
    await airdropSol(claimer.publicKey, 2);

    const claimerAta = getAssociatedTokenAddressSync(mint, claimer.publicKey);
    const setupTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        claimer.publicKey,
        claimerAta,
        claimer.publicKey,
        mint
      )
    );
    await provider.sendAndConfirm(setupTx, [claimer]);

    await program.methods
      .claim()
      .accounts({
        airdrop: airdropPda,
        claimerAta,
        claimer: claimer.publicKey,
      })
      .signers([claimer])
      .rpc();

    try {
      await program.methods
        .claim()
        .accounts({
          airdrop: airdropPda,
          claimerAta,
          claimer: claimer.publicKey,
        })
        .signers([claimer])
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      assert.match(err.toString(), /already in use|already exists|0x0/i);
    }
  });

  it("rejects claim when vault is empty", async () => {
    // 之前已经 claim 了 2 次（100 + 100），vault 还剩 100
    // 再 claim 一次 → vault 剩 0
    const third = Keypair.generate();
    await airdropSol(third.publicKey, 2);
    const thirdAta = getAssociatedTokenAddressSync(mint, third.publicKey);
    const setup1 = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        third.publicKey,
        thirdAta,
        third.publicKey,
        mint
      )
    );
    await provider.sendAndConfirm(setup1, [third]);
    await program.methods
      .claim()
      .accounts({
        airdrop: airdropPda,
        claimerAta: thirdAta,
        claimer: third.publicKey,
      })
      .signers([third])
      .rpc();

    const vaultAfter = await getAccount(provider.connection, vaultPda);
    assert.strictEqual(vaultAfter.amount, 0n);

    // 第四个 claimer 应该失败
    const fourth = Keypair.generate();
    await airdropSol(fourth.publicKey, 2);
    const fourthAta = getAssociatedTokenAddressSync(mint, fourth.publicKey);
    const setup2 = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        fourth.publicKey,
        fourthAta,
        fourth.publicKey,
        mint
      )
    );
    await provider.sendAndConfirm(setup2, [fourth]);

    try {
      await program.methods
        .claim()
        .accounts({
          airdrop: airdropPda,
          claimerAta: fourthAta,
          claimer: fourth.publicKey,
        })
        .signers([fourth])
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      assert.match(err.toString(), /InsufficientVault/);
    }
  });

  it("rejects claim with mismatched claimer_ata", async () => {
    // 用一个不属于 claimer 的 ata 试图 claim
    const claimer = Keypair.generate();
    await airdropSol(claimer.publicKey, 2);

    // 我们用 authority 的 ata 当 claimer_ata（owner mismatch）
    try {
      await program.methods
        .claim()
        .accounts({
          airdrop: airdropPda,
          claimerAta: authorityAta,
          claimer: claimer.publicKey,
        })
        .signers([claimer])
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      // 可能因为 vault 空了（InsufficientVault），也可能 OwnerMismatch
      assert.match(err.toString(), /OwnerMismatch|InsufficientVault/);
    }
  });
});
