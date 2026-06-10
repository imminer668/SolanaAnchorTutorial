import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import { SplToken } from "../target/types/spl_token";
import { assert } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";

describe("spl-token", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.splToken as Program<SplToken>;
  const wallet = provider.wallet as anchor.Wallet;

  // 1. Create Mint
  const mintKeypair = Keypair.generate();
  const mintAuthority = wallet.publicKey; // 简化：用 wallet 作为 mint authority

  // 2. Create ATA
  const userAta = getAssociatedTokenAddressSync(
    mintKeypair.publicKey,
    wallet.publicKey
  );
  const recipient = Keypair.generate();
  const recipientAta = getAssociatedTokenAddressSync(
    mintKeypair.publicKey,
    recipient.publicKey
  );

  it("creates a mint", async () => {
    await program.methods
      .createMint()
      .accounts({
        mint: mintKeypair.publicKey,
        mintAuthority: mintAuthority,
        payer: wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc();

    const mintInfo = await provider.connection.getAccountInfo(
      mintKeypair.publicKey
    );
    assert.ok(mintInfo !== null);
  });

  it("creates an ATA", async () => {
    const tx = new (require("@solana/web3.js").Transaction)().add(
      require("@solana/spl-token").createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        userAta,
        wallet.publicKey,
        mintKeypair.publicKey,
        TOKEN_PROGRAM_ID
      )
    );
    await provider.sendAndConfirm(tx, [wallet.payer]);

    const ataInfo = await provider.connection.getAccountInfo(userAta);
    assert.ok(ataInfo !== null);
  });

  it("mints tokens to the ATA", async () => {
    const mintAmount = 100 * 10 ** 9; // 100 tokens (decimals=9)

    await program.methods
      .mintToken(new anchor.BN(mintAmount))
      .accounts({
        mint: mintKeypair.publicKey,
        destination: userAta,
        mintAuthority: mintAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const account = await getAccount(provider.connection, userAta);
    assert.strictEqual(Number(account.amount), mintAmount);
  });

  it("transfers tokens between ATAs", async () => {
    // 先为 recipient 创建 ATA
    const tx = new (require("@solana/web3.js").Transaction)().add(
      require("@solana/spl-token").createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        recipientAta,
        recipient.publicKey,
        mintKeypair.publicKey,
        TOKEN_PROGRAM_ID
      )
    );
    await provider.sendAndConfirm(tx, [wallet.payer]);

    // 转账 30 tokens (decimals=9)
    const transferAmount = 30 * 10 ** 9;

    await program.methods
      .transferToken(new anchor.BN(transferAmount))
      .accounts({
        source: userAta,
        destination: recipientAta,
        sourceAuthority: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const sourceAccount = await getAccount(provider.connection, userAta);
    const destAccount = await getAccount(provider.connection, recipientAta);
    assert.strictEqual(Number(sourceAccount.amount), 70 * 10 ** 9);
    assert.strictEqual(Number(destAccount.amount), 30 * 10 ** 9);
  });

  it("fails when transferring more than balance", async () => {
    const tooMuch = 1000 * 10 ** 9;

    try {
      await program.methods
        .transferToken(new anchor.BN(tooMuch))
        .accounts({
          source: userAta,
          destination: recipientAta,
          sourceAuthority: wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      assert.instanceOf(err, AnchorError);
      const anchorErr = err as AnchorError;
      assert.strictEqual(anchorErr.error.errorCode.code, "InsufficientBalance");
    }
  });
});
