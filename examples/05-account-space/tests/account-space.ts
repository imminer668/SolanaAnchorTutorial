import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import { AccountSpace } from "../target/types/account_space";
import { assert } from "chai";
import { PublicKey } from "@solana/web3.js";

describe("account-space", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.accountSpace as Program<AccountSpace>;
  const wallet = provider.wallet as anchor.Wallet;

  const MAX_LABEL_LEN = 50;
  const MAX_SCORES = 16;

  function deriveCounter(user: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("counter"), user.toBuffer()],
      program.programId
    );
  }

  it("initializes counter with a valid label", async () => {
    const [counter] = deriveCounter(wallet.publicKey);
    const label = "my-counter";

    await program.methods
      .initialize(label)
      .accounts({
        counter,
        user: wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const account = await program.account.counter.fetch(counter);
    assert.ok(account.authority.equals(wallet.publicKey));
    assert.strictEqual(account.count.toNumber(), 0);
    assert.strictEqual(account.label, label);
    assert.strictEqual(account.scores.length, 0);
  });

  it("rejects label longer than MAX_LABEL_LEN", async () => {
    const otherUser = anchor.web3.Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      otherUser.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    const [counter] = deriveCounter(otherUser.publicKey);
    const longLabel = "x".repeat(MAX_LABEL_LEN + 1);

    try {
      await program.methods
        .initialize(longLabel)
        .accounts({
          counter,
          user: otherUser.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([otherUser])
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      assert.instanceOf(err, AnchorError);
      const anchorErr = err as AnchorError;
      assert.strictEqual(anchorErr.error.errorCode.code, "LabelTooLong");
    }
  });

  it("increments and decrements correctly", async () => {
    const [counter] = deriveCounter(wallet.publicKey);

    await program.methods
      .increment()
      .accounts({
        counter,
        authority: wallet.publicKey,
      })
      .rpc();

    let account = await program.account.counter.fetch(counter);
    assert.strictEqual(account.count.toNumber(), 1);

    await program.methods
      .increment()
      .accounts({
        counter,
        authority: wallet.publicKey,
      })
      .rpc();

    account = await program.account.counter.fetch(counter);
    assert.strictEqual(account.count.toNumber(), 2);

    await program.methods
      .decrement()
      .accounts({
        counter,
        authority: wallet.publicKey,
      })
      .rpc();

    account = await program.account.counter.fetch(counter);
    assert.strictEqual(account.count.toNumber(), 1);
  });

  it("fails decrement at zero (underflow)", async () => {
    const [counter] = deriveCounter(wallet.publicKey);

    // 重置为 0
    await program.methods
      .reset()
      .accounts({
        counter,
        authority: wallet.publicKey,
      })
      .rpc();

    try {
      await program.methods
        .decrement()
        .accounts({
          counter,
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

  it("updates label within the limit", async () => {
    const [counter] = deriveCounter(wallet.publicKey);
    const newLabel = "renamed";

    await program.methods
      .updateLabel(newLabel)
      .accounts({
        counter,
        authority: wallet.publicKey,
      })
      .rpc();

    const account = await program.account.counter.fetch(counter);
    assert.strictEqual(account.label, newLabel);
  });

  it("rejects unauthorized increment", async () => {
    const otherUser = anchor.web3.Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      otherUser.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    const [counter] = deriveCounter(wallet.publicKey);

    try {
      await program.methods
        .increment()
        .accounts({
          counter,
          authority: otherUser.publicKey,
        })
        .signers([otherUser])
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      assert.instanceOf(err, AnchorError);
      const anchorErr = err as AnchorError;
      assert.strictEqual(anchorErr.error.errorCode.code, "Unauthorized");
    }
  });

  it("pushes scores up to MAX_SCORES, then fails", async () => {
    const [counter] = deriveCounter(wallet.publicKey);

    // 把 score 全部填满
    for (let i = 0; i < MAX_SCORES; i++) {
      await program.methods
        .pushScore(100 + i)
        .accounts({
          counter,
          authority: wallet.publicKey,
        })
        .rpc();
    }

    const account = await program.account.counter.fetch(counter);
    assert.strictEqual(account.scores.length, MAX_SCORES);

    // 第 MAX_SCORES + 1 次应该失败
    try {
      await program.methods
        .pushScore(999)
        .accounts({
          counter,
          authority: wallet.publicKey,
        })
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      assert.instanceOf(err, AnchorError);
      const anchorErr = err as AnchorError;
      assert.strictEqual(anchorErr.error.errorCode.code, "ScoresFull");
    }
  });
});
