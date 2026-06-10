import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import { Counter } from "../target/types/counter";
import { assert } from "chai";
import { Keypair, SystemProgram } from "@solana/web3.js";

describe("counter", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.counter as Program<Counter>;
  const wallet = provider.wallet as anchor.Wallet;

  // 用于"非 authority 调用失败"测试的伪造 authority
  const fakeAuthority = Keypair.generate();

  // PDA 风格的 keypair (anchor.init 在测试中会显式创建账户)
  const counterKeypair = Keypair.generate();

  it("initializes the counter", async () => {
    const tx = await program.methods
      .initialize()
      .accounts({
        counter: counterKeypair.publicKey,
        user: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([counterKeypair])
      .rpc();

    console.log("Initialize tx:", tx);

    const account = await program.account.counter.fetch(
      counterKeypair.publicKey
    );
    assert.ok(account.authority.equals(wallet.publicKey));
    assert.strictEqual(account.count.toNumber(), 0);
  });

  it("increments the counter", async () => {
    await program.methods
      .increment()
      .accounts({
        counter: counterKeypair.publicKey,
        authority: wallet.publicKey,
      })
      .rpc();

    const account = await program.account.counter.fetch(
      counterKeypair.publicKey
    );
    assert.strictEqual(account.count.toNumber(), 1);
  });

  it("decrements the counter", async () => {
    await program.methods
      .decrement()
      .accounts({
        counter: counterKeypair.publicKey,
        authority: wallet.publicKey,
      })
      .rpc();

    const account = await program.account.counter.fetch(
      counterKeypair.publicKey
    );
    assert.strictEqual(account.count.toNumber(), 0);
  });

  it("resets the counter", async () => {
    // 先 +5 再 reset
    for (let i = 0; i < 5; i++) {
      await program.methods
        .increment()
        .accounts({
          counter: counterKeypair.publicKey,
          authority: wallet.publicKey,
        })
        .rpc();
    }
    let account = await program.account.counter.fetch(counterKeypair.publicKey);
    assert.strictEqual(account.count.toNumber(), 5);

    await program.methods
      .reset()
      .accounts({
        counter: counterKeypair.publicKey,
        authority: wallet.publicKey,
      })
      .rpc();

    account = await program.account.counter.fetch(counterKeypair.publicKey);
    assert.strictEqual(account.count.toNumber(), 0);
  });

  it("fails when non-authority tries to increment", async () => {
    // 给 fakeAuthority 打钱以便支付 fee (虽然不需要，但保险)
    const airdropSig = await provider.connection.requestAirdrop(
      fakeAuthority.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    try {
      await program.methods
        .increment()
        .accounts({
          counter: counterKeypair.publicKey,
          authority: fakeAuthority.publicKey,
        })
        .signers([fakeAuthority])
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      assert.instanceOf(err, AnchorError);
      const anchorErr = err as AnchorError;
      assert.strictEqual(anchorErr.error.errorCode.code, "Unauthorized");
    }
  });

  it("fails when decrementing below zero", async () => {
    // 此时 count 是 0（reset 之后），decrement 应失败
    try {
      await program.methods
        .decrement()
        .accounts({
          counter: counterKeypair.publicKey,
          authority: wallet.publicKey,
        })
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      assert.instanceOf(err, AnchorError);
      const anchorErr = err as AnchorError;
      assert.strictEqual(anchorErr.error.errorCode.code, "Underflow");
    }
  });
});
