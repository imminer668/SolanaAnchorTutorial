import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import { PdaUserProfile } from "../target/types/pda_user_profile";
import { assert } from "chai";
import { PublicKey, SystemProgram } from "@solana/web3.js";

describe("pda-user-profile", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.pdaUserProfile as Program<PdaUserProfile>;
  const wallet = provider.wallet as anchor.Wallet;

  // 推导 PDA
  const [profilePda, profileBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("profile"), wallet.publicKey.toBuffer()],
    program.programId
  );

  const fakeUser = anchor.web3.Keypair.generate();
  const [fakeProfilePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("profile"), fakeUser.publicKey.toBuffer()],
    program.programId
  );

  it("creates a profile", async () => {
    // 给 fakeUser 一些 SOL 以便后续测试
    const airdropSig = await provider.connection.requestAirdrop(
      fakeUser.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    await program.methods
      .createProfile("Alice", "Hello Solana")
      .accounts({
        profile: profilePda,
        user: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const account = await program.account.userProfile.fetch(profilePda);
    assert.strictEqual(account.name, "Alice");
    assert.strictEqual(account.bio, "Hello Solana");
    assert.ok(account.user.equals(wallet.publicKey));
    assert.strictEqual(account.bump, profileBump);
  });

  it("updates a profile", async () => {
    await program.methods
      .updateProfile("Alice 2.0", "Updated bio")
      .accounts({
        profile: profilePda,
        user: wallet.publicKey,
      })
      .rpc();

    const account = await program.account.userProfile.fetch(profilePda);
    assert.strictEqual(account.name, "Alice 2.0");
    assert.strictEqual(account.bio, "Updated bio");
  });

  it("fails when wrong user updates", async () => {
    try {
      await program.methods
        .updateProfile("Hacked", "Should not work")
        .accounts({
          profile: profilePda,
          user: fakeUser.publicKey,
        })
        .signers([fakeUser])
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      // 可能是 seeds 错误（fakeUser 推导出错误的 PDA），
      // 也可能是 has_one 错误
      assert.instanceOf(err, AnchorError);
    }
  });

  it("fails when name is too long", async () => {
    const longName = "a".repeat(60);
    try {
      await program.methods
        .updateProfile(longName, "bio")
        .accounts({
          profile: profilePda,
          user: wallet.publicKey,
        })
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      assert.instanceOf(err, AnchorError);
      const anchorErr = err as AnchorError;
      assert.strictEqual(anchorErr.error.errorCode.code, "NameTooLong");
    }
  });

  it("closes the profile", async () => {
    const beforeBalance = await provider.connection.getBalance(
      wallet.publicKey
    );

    await program.methods
      .closeProfile()
      .accounts({
        profile: profilePda,
        user: wallet.publicKey,
      })
      .rpc();

    // 关闭后账户应不存在
    const accountInfo = await provider.connection.getAccountInfo(profilePda);
    assert.strictEqual(accountInfo, null);

    // lamports 应退给 user
    const afterBalance = await provider.connection.getBalance(wallet.publicKey);
    assert.ok(afterBalance > beforeBalance);
  });

  it("fails to fetch closed profile", async () => {
    try {
      await program.account.userProfile.fetch(profilePda);
      assert.fail("Should have thrown an error");
    } catch (err) {
      // Account 不存在时 fetch 报错
      assert.ok(err);
    }
  });
});
