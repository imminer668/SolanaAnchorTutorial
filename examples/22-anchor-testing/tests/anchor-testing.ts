import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import { AnchorTesting } from "../target/types/anchor_testing";
import { assert } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

describe("anchor_testing", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.anchorTesting as Program<AnchorTesting>;
  const authority = (provider.wallet as anchor.Wallet).payer;

  // ============== 模式 1: PDA 推导 ==============
  function counterPdaFor(user: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("counter"), user.toBuffer()],
      program.programId
    )[0];
  }

  async function airdropSol(to: PublicKey, sol = 1) {
    const sig = await provider.connection.requestAirdrop(
      to,
      sol * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "confirmed");
  }

  async function sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============== 测试 1: 成功路径 ==============
  it("initializes counter (success path + account fetch)", async () => {
    const user = Keypair.generate();
    await airdropSol(user.publicKey);
    const counterPda = counterPdaFor(user.publicKey);

    // 1) 调用 initialize
    await program.methods
      .initialize()
      .accounts({
        counter: counterPda,
        authority: user.publicKey,
      })
      .signers([user])
      .rpc();

    // 2) 读取账户并断言字段（账户读取断言）
    const counter = await program.account.counter.fetch(counterPda);
    assert.strictEqual(counter.authority.toBase58(), user.publicKey.toBase58());
    assert.strictEqual(counter.count.toString(), "0");
  });

  // ============== 测试 2: 失败路径 + 错误码断言 ==============
  it("rejects increment from non-authority with NotAuthority error", async () => {
    const user = Keypair.generate();
    const attacker = Keypair.generate();
    await airdropSol(user.publicKey);
    const counterPda = counterPdaFor(user.publicKey);

    // 先用 user 初始化
    await program.methods
      .initialize()
      .accounts({
        counter: counterPda,
        authority: user.publicKey,
      })
      .signers([user])
      .rpc();

    // attacker 试图 increment
    try {
      await program.methods
        .increment()
        .accounts({
          counter: counterPda,
          authority: attacker.publicKey, // ❌ 传 attacker 当 authority
        })
        .signers([attacker])
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      // 错误码断言
      assert.isTrue(err instanceof AnchorError);
      assert.strictEqual(err.error.errorCode.code, "NotAuthority");
      assert.strictEqual(err.error.errorCode.number, 6000);
    }
  });

  // ============== 测试 3: 业务失败 + 错误码断言 ==============
  it("rejects decrement at 0 with Underflow error", async () => {
    const user = Keypair.generate();
    await airdropSol(user.publicKey);
    const counterPda = counterPdaFor(user.publicKey);

    await program.methods
      .initialize()
      .accounts({
        counter: counterPda,
        authority: user.publicKey,
      })
      .signers([user])
      .rpc();

    // 直接 decrement（count = 0）
    try {
      await program.methods
        .decrement()
        .accounts({
          counter: counterPda,
          authority: user.publicKey,
        })
        .signers([user])
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      assert.isTrue(err instanceof AnchorError);
      assert.strictEqual(err.error.errorCode.code, "Underflow");
    }
  });

  // ============== 测试 4: 多次操作 + 累加断言 ==============
  it("increments and decrements correctly (multiple ops)", async () => {
    const user = Keypair.generate();
    await airdropSol(user.publicKey);
    const counterPda = counterPdaFor(user.publicKey);

    await program.methods
      .initialize()
      .accounts({
        counter: counterPda,
        authority: user.publicKey,
      })
      .signers([user])
      .rpc();

    // +1, +1, +1, -1
    for (let i = 0; i < 3; i++) {
      await program.methods
        .increment()
        .accounts({ counter: counterPda, authority: user.publicKey })
        .signers([user])
        .rpc();
    }
    let c = await program.account.counter.fetch(counterPda);
    assert.strictEqual(c.count.toString(), "3");

    await program.methods
      .decrement()
      .accounts({ counter: counterPda, authority: user.publicKey })
      .signers([user])
      .rpc();
    c = await program.account.counter.fetch(counterPda);
    assert.strictEqual(c.count.toString(), "2");
  });

  // ============== 测试 5: set_value + 账户断言 ==============
  it("set_value updates count to any value", async () => {
    const user = Keypair.generate();
    await airdropSol(user.publicKey);
    const counterPda = counterPdaFor(user.publicKey);

    await program.methods
      .initialize()
      .accounts({
        counter: counterPda,
        authority: user.publicKey,
      })
      .signers([user])
      .rpc();

    await program.methods
      .setValue(new anchor.BN(42))
      .accounts({ counter: counterPda, authority: user.publicKey })
      .signers([user])
      .rpc();

    const c = await program.account.counter.fetch(counterPda);
    assert.strictEqual(c.count.toString(), "42");
  });

  // ============== 测试 6: close + 账户不存在断言 ==============
  it("closes counter and account is no longer accessible", async () => {
    const user = Keypair.generate();
    await airdropSol(user.publicKey);
    const counterPda = counterPdaFor(user.publicKey);

    await program.methods
      .initialize()
      .accounts({
        counter: counterPda,
        authority: user.publicKey,
      })
      .signers([user])
      .rpc();

    // 关闭
    await program.methods
      .closeCounter()
      .accounts({
        counter: counterPda,
        authority: user.publicKey,
      })
      .signers([user])
      .rpc();

    // 关闭后 fetch 应该失败
    try {
      await program.account.counter.fetch(counterPda);
      assert.fail("account should not exist");
    } catch (err: any) {
      // Account does not exist or has no data
      assert.match(err.toString(), /Account does not exist/);
    }
  });

  // ============== 测试 7: 事件日志读取 ==============
  it("writes Anchor event log on increment", async () => {
    const user = Keypair.generate();
    await airdropSol(user.publicKey);
    const counterPda = counterPdaFor(user.publicKey);

    await program.methods
      .initialize()
      .accounts({
        counter: counterPda,
        authority: user.publicKey,
      })
      .signers([user])
      .rpc();

    const sig = await program.methods
      .increment()
      .accounts({ counter: counterPda, authority: user.publicKey })
      .signers([user])
      .rpc();

    let tx = await provider.connection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    for (let i = 0; i < 10 && !tx; i++) {
      await sleep(500);
      tx = await provider.connection.getTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
    }

    assert.isNotNull(tx);

    const logs = tx!.meta?.logMessages ?? [];

    assert.includeMembers(logs, ["Program log: Instruction: Increment"]);
    assert.isTrue(
      logs.some((log) => log.startsWith("Program data: ")),
      "expected Anchor event data log"
    );
  });
});
