import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import { Escrow } from "../target/types/escrow";
import { assert } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
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

describe("escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.escrow as Program<Escrow>;
  const wallet = provider.wallet as anchor.Wallet;

  let mintA: PublicKey;
  let mintB: PublicKey;
  let makerAtaA: PublicKey;
  let taker: Keypair;
  let takerAtaA: PublicKey;
  let takerAtaB: PublicKey;
  let makerAtaB: PublicKey;

  const escrowId = new anchor.BN(1);
  const amountA = 10 * 10 ** 9; // 10 tokens
  const amountB = 5 * 10 ** 9; // 5 tokens

  before(async () => {
    // 给 taker 打钱
    taker = Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(
      taker.publicKey,
      5 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    // 创建两个 mint
    mintA = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      9
    );
    mintB = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      9
    );

    // maker 的 ATA for A
    const makerTokenAAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mintA,
      wallet.publicKey
    );
    makerAtaA = makerTokenAAccount.address;

    // 给 maker 一些 token A
    await mintTo(
      provider.connection,
      wallet.payer,
      mintA,
      makerAtaA,
      wallet.publicKey,
      100 * 10 ** 9
    );

    // taker 的 ATA for A & B
    const takerAtaAAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mintA,
      taker.publicKey
    );
    takerAtaA = takerAtaAAccount.address;

    const takerAtaBAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mintB,
      taker.publicKey
    );
    takerAtaB = takerAtaBAccount.address;

    // 给 taker 一些 token B
    await mintTo(
      provider.connection,
      wallet.payer,
      mintB,
      takerAtaB,
      wallet.publicKey,
      100 * 10 ** 9
    );

    // maker 的 ATA for B (用来收 taker 的 token B)
    const makerAtaBAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mintB,
      wallet.publicKey
    );
    makerAtaB = makerAtaBAccount.address;
  });

  function deriveEscrowAndVault() {
    const [escrowPda, escrowBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        wallet.publicKey.toBuffer(),
        escrowId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowPda.toBuffer()],
      program.programId
    );
    return { escrowPda, escrowBump, vaultPda, vaultBump };
  }

  it("creates an escrow", async () => {
    const { escrowPda, vaultPda } = deriveEscrowAndVault();

    await program.methods
      .createEscrow(escrowId, new anchor.BN(amountA), new anchor.BN(amountB))
      .accounts({
        escrow: escrowPda,
        vault: vaultPda,
        mintA: mintA,
        mintB: mintB,
        maker: wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const escrow = await program.account.escrow.fetch(escrowPda);
    assert.ok(escrow.maker.equals(wallet.publicKey));
    assert.ok(escrow.mintA.equals(mintA));
    assert.ok(escrow.mintB.equals(mintB));
    assert.strictEqual(escrow.amountA.toNumber(), amountA);
    assert.strictEqual(escrow.amountB.toNumber(), amountB);
  });

  it("deposits token A into the vault", async () => {
    const { escrowPda, vaultPda } = deriveEscrowAndVault();

    await program.methods
      .depositToken(new anchor.BN(amountA))
      .accounts({
        escrow: escrowPda,
        vault: vaultPda,
        makerTokenA: makerAtaA,
        maker: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const vaultAccount = await getAccount(provider.connection, vaultPda);
    assert.strictEqual(Number(vaultAccount.amount), amountA);
  });

  it("exchanges: taker gets token A, maker gets token B", async () => {
    const { escrowPda, vaultPda } = deriveEscrowAndVault();

    const takerBBefore = await getAccount(provider.connection, takerAtaB);
    const makerBBefore = await getAccount(provider.connection, makerAtaB);

    await program.methods
      .exchange()
      .accounts({
        escrow: escrowPda,
        vault: vaultPda,
        takerTokenB: takerAtaB,
        takerTokenA: takerAtaA,
        makerTokenB: makerAtaB,
        maker: wallet.publicKey,
        taker: taker.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([taker])
      .rpc();

    const takerAAfter = await getAccount(provider.connection, takerAtaA);
    const makerBAfter = await getAccount(provider.connection, makerAtaB);
    const takerBAfter = await getAccount(provider.connection, takerAtaB);

    assert.strictEqual(Number(takerAAfter.amount), amountA);
    assert.strictEqual(
      Number(makerBAfter.amount),
      Number(makerBBefore.amount) + amountB
    );
    assert.strictEqual(
      Number(takerBAfter.amount),
      Number(takerBBefore.amount) - amountB
    );

    // vault 应被关闭
    const vaultInfo = await provider.connection.getAccountInfo(vaultPda);
    assert.strictEqual(vaultInfo, null);

    // escrow 应被关闭
    const escrowInfo = await provider.connection.getAccountInfo(escrowPda);
    assert.strictEqual(escrowInfo, null);
  });

  it("fails exchange when taker has insufficient token B", async () => {
    // 创建第二个 escrow 来测试失败路径
    const escrowId2 = new anchor.BN(2);
    const { escrowPda, vaultPda } = (() => {
      const [e] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow"),
          wallet.publicKey.toBuffer(),
          escrowId2.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const [v] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), e.toBuffer()],
        program.programId
      );
      return { escrowPda: e, vaultPda: v };
    })();

    // 先创建 escrow
    await program.methods
      .createEscrow(escrowId2, new anchor.BN(amountA), new anchor.BN(amountB))
      .accounts({
        escrow: escrowPda,
        vault: vaultPda,
        mintA: mintA,
        mintB: mintB,
        maker: wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    // 存入 token A
    await program.methods
      .depositToken(new anchor.BN(amountA))
      .accounts({
        escrow: escrowPda,
        vault: vaultPda,
        makerTokenA: makerAtaA,
        maker: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // 创建另一个 taker，没有 token B
    const poorTaker = Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(
      poorTaker.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    const poorTakerAtaB = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mintB,
      poorTaker.publicKey
    );

    try {
      await program.methods
        .exchange()
        .accounts({
          escrow: escrowPda,
          vault: vaultPda,
          takerTokenB: poorTakerAtaB.address,
          takerTokenA: takerAtaA,
          makerTokenB: makerAtaB,
          maker: wallet.publicKey,
          taker: poorTaker.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([poorTaker])
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      assert.instanceOf(err, AnchorError);
      const anchorErr = err as AnchorError;
      assert.strictEqual(
        anchorErr.error.errorCode.code,
        "InsufficientTakerFunds"
      );
    }
  });

  it("cancels an escrow and returns token A to maker", async () => {
    // 创建第三个 escrow 来测试 cancel
    const escrowId3 = new anchor.BN(3);
    const { escrowPda, vaultPda } = (() => {
      const [e] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow"),
          wallet.publicKey.toBuffer(),
          escrowId3.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const [v] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), e.toBuffer()],
        program.programId
      );
      return { escrowPda: e, vaultPda: v };
    })();

    // 创建 escrow
    await program.methods
      .createEscrow(escrowId3, new anchor.BN(amountA), new anchor.BN(amountB))
      .accounts({
        escrow: escrowPda,
        vault: vaultPda,
        mintA: mintA,
        mintB: mintB,
        maker: wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    // 存入 token A
    await program.methods
      .depositToken(new anchor.BN(amountA))
      .accounts({
        escrow: escrowPda,
        vault: vaultPda,
        makerTokenA: makerAtaA,
        maker: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const makerABefore = await getAccount(provider.connection, makerAtaA);

    // cancel
    await program.methods
      .cancel()
      .accounts({
        escrow: escrowPda,
        vault: vaultPda,
        makerTokenA: makerAtaA,
        maker: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const makerAAfter = await getAccount(provider.connection, makerAtaA);
    assert.strictEqual(
      Number(makerAAfter.amount),
      Number(makerABefore.amount) + amountA
    );

    // vault 应被关闭
    const vaultInfo = await provider.connection.getAccountInfo(vaultPda);
    assert.strictEqual(vaultInfo, null);
  });
});
