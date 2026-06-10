import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Token2022Demo } from "../target/types/token2022_demo";
import { assert } from "chai";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createInitializePermanentDelegateInstruction,
  createInitializeMetadataPointerInstruction,
  getMint,
  getTransferFeeConfig,
  getPermanentDelegate,
  getMetadataPointerState,
  transferChecked,
  burnChecked,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  mintToChecked,
  getAccount,
} from "@solana/spl-token";

describe("token2022", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.token2022Demo as Program<Token2022Demo>;
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  let mint: Keypair;
  let mintAuthority: Keypair;
  let permanentDelegate: Keypair;
  let feeConfigAuthority: Keypair;
  let withdrawAuthority: Keypair;

  // 1% transfer fee (100 basis points)
  const FEE_BASIS_POINTS = 100;
  // 最大单笔 fee = 100 token，避免 cap 实际费率
  const MAX_FEE = 100_000_000_000n;

  before(async () => {
    mintAuthority = Keypair.generate();
    permanentDelegate = Keypair.generate();
    feeConfigAuthority = Keypair.generate();
    withdrawAuthority = Keypair.generate();

    // 给 authorities 打钱
    for (const kp of [
      mintAuthority,
      permanentDelegate,
      feeConfigAuthority,
      withdrawAuthority,
    ]) {
      const sig = await connection.requestAirdrop(
        kp.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(sig);
    }
  });

  it("creates a Token2022 mint with transfer fee + permanent delegate", async () => {
    mint = Keypair.generate();

    // 1. 计算 mint 空间：base + transfer-fee + permanent-delegate + metadata-pointer
    const extensions = [
      ExtensionType.TransferFeeConfig,
      ExtensionType.PermanentDelegate,
      ExtensionType.MetadataPointer,
    ];
    const mintLen = getMintLen(extensions);
    const mintRent = await connection.getMinimumBalanceForRentExemption(
      mintLen
    );

    // 2. 准备初始化指令（顺序：扩展先于 mint 本身）
    const createAccountIx = SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: mintRent,
      space: mintLen,
      programId: TOKEN_2022_PROGRAM_ID,
    });

    // Transfer Fee Config
    const initTransferFeeIx = createInitializeTransferFeeConfigInstruction(
      mint.publicKey,
      feeConfigAuthority.publicKey, // 配置者
      withdrawAuthority.publicKey, // 提取者
      FEE_BASIS_POINTS,
      MAX_FEE,
      TOKEN_2022_PROGRAM_ID
    );

    // Permanent Delegate
    const initPermDelIx = createInitializePermanentDelegateInstruction(
      mint.publicKey,
      permanentDelegate.publicKey,
      TOKEN_2022_PROGRAM_ID
    );

    // Metadata Pointer（指向一个 metadata 账户地址，本课不实际写入 metadata）
    const metadataAccount = Keypair.generate();
    const initMetadataPtrIx = createInitializeMetadataPointerInstruction(
      mint.publicKey,
      feeConfigAuthority.publicKey, // metadata authority
      metadataAccount.publicKey, // metadata account address
      TOKEN_2022_PROGRAM_ID
    );

    // Mint 本身
    const initMintIx = createInitializeMintInstruction(
      mint.publicKey,
      9, // decimals
      mintAuthority.publicKey,
      null, // freeze authority
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new Transaction().add(
      createAccountIx,
      initTransferFeeIx,
      initPermDelIx,
      initMetadataPtrIx,
      initMintIx
    );

    await provider.sendAndConfirm(tx, [mint]);

    // 验证扩展已正确写入
    const mintInfo = await getMint(
      connection,
      mint.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // 1) Transfer Fee Config
    const transferFeeConfig = getTransferFeeConfig(mintInfo);
    assert.isNotNull(transferFeeConfig);
    assert.strictEqual(
      transferFeeConfig!.newerTransferFee.transferFeeBasisPoints,
      FEE_BASIS_POINTS
    );
    assert.ok(
      transferFeeConfig!.withdrawWithheldAuthority.equals(
        withdrawAuthority.publicKey
      )
    );

    // 2) Permanent Delegate
    const pd = getPermanentDelegate(mintInfo);
    assert.isNotNull(pd);
    assert.ok(pd!.delegate.equals(permanentDelegate.publicKey));

    // 3) Metadata Pointer
    const metaPtr = getMetadataPointerState(mintInfo);
    assert.isNotNull(metaPtr);
    assert.ok(metaPtr!.metadataAddress.equals(metadataAccount.publicKey));
  });

  it("applies 1% transfer fee on a 1000-token transfer", async () => {
    // 给 mintAuthority 打钱（用来 mint）
    const sig = await connection.requestAirdrop(
      mintAuthority.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig);

    // 创建 mintAuthority 和 recipient 的 ATA
    const sourceAta = getAssociatedTokenAddressSync(
      mint.publicKey,
      mintAuthority.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const recipientAta = getAssociatedTokenAddressSync(
      mint.publicKey,
      wallet.publicKey, // 用 wallet 当 recipient
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        sourceAta,
        mintAuthority.publicKey,
        mint.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      ),
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        recipientAta,
        wallet.publicKey,
        mint.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    await provider.sendAndConfirm(tx);

    // 给 source mint 1000 token
    const mintAmount = 1_000_000_000_000n; // 1000 * 10^9
    await mintToChecked(
      connection,
      wallet.payer,
      mint.publicKey,
      sourceAta,
      mintAuthority,
      mintAmount,
      9,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // 转 1000 token，期望扣 1% fee = 10 token
    const transferAmount = 1_000_000_000_000n;
    const sig2 = await transferChecked(
      connection,
      wallet.payer,
      sourceAta,
      mint.publicKey,
      recipientAta,
      mintAuthority, // owner of sourceAta
      transferAmount,
      9,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    await connection.confirmTransaction(sig2);

    const sourceAccount = await getAccount(
      connection,
      sourceAta,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    const recipientAccount = await getAccount(
      connection,
      recipientAta,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // 1% = 10 token
    const expectedFee = transferAmount / 100n;
    const expectedReceived = transferAmount - expectedFee;

    assert.strictEqual(recipientAccount.amount, expectedReceived);
    // 源账户少了 1000（fee 会"暂存"在源账户，不是直接消失）
    assert.strictEqual(sourceAccount.amount, mintAmount - transferAmount);

    // 验证 fee 进入了源账户的 withheld 字段
    const mintInfo = await getMint(
      connection,
      mint.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    const feeConfig = getTransferFeeConfig(mintInfo);
    // transferFeeAmount 是最近一次 transfer 计算出的 fee
    // 由于是最新一次操作，应该等于 10 token
    assert.strictEqual(
      feeConfig!.newerTransferFee.transferFeeBasisPoints,
      FEE_BASIS_POINTS
    );
  });

  it("permanent delegate can burn from any holder's account", async () => {
    // burn from the recipient (wallet) account, which has 990 tokens after the 1% fee
    const recipientAta = getAssociatedTokenAddressSync(
      mint.publicKey,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const before = await getAccount(
      connection,
      recipientAta,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    assert.ok(before.amount > 0n, "recipient should still have tokens");

    const burnAmount = 100_000_000_000n; // 100 token
    const sig = await burnChecked(
      connection,
      permanentDelegate, // payer of tx fee
      recipientAta, // target token account (owner is wallet)
      mint.publicKey,
      permanentDelegate, // authority is permanent delegate
      burnAmount,
      9,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    await connection.confirmTransaction(sig);

    const after = await getAccount(
      connection,
      recipientAta,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    assert.strictEqual(after.amount, before.amount - burnAmount);
  });

  it("non-permanent-delegate cannot burn from another's account", async () => {
    const sourceAta = getAssociatedTokenAddressSync(
      mint.publicKey,
      mintAuthority.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    // randomUser 不是 owner 也不是 permanent delegate
    const randomUser = Keypair.generate();
    const sig = await connection.requestAirdrop(
      randomUser.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig);

    let threw = false;
    try {
      await burnChecked(
        connection,
        randomUser, // 错的 authority
        sourceAta,
        mint.publicKey,
        randomUser, // 错的 authority
        1_000_000_000n,
        9,
        [],
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
    } catch (e) {
      threw = true;
    }
    assert.isTrue(threw, "burn should fail for non-delegate signer");
  });

  it("calls our anchor program to record the burn", async () => {
    const sig = await program.methods
      .recordBurn(new anchor.BN(100_000_000))
      .accounts({
        mint: mint.publicKey,
        delegate: permanentDelegate.publicKey,
      })
      .signers([permanentDelegate])
      .rpc();

    await connection.confirmTransaction(sig);
    assert.ok(sig);
  });
});
