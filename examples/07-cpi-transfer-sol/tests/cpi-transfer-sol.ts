import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import { CpiTransferSol } from "../target/types/cpi_transfer_sol";
import { assert } from "chai";
import {
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Keypair,
} from "@solana/web3.js";

describe("cpi-transfer-sol", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.cpiTransferSol as Program<CpiTransferSol>;
  const wallet = provider.wallet as anchor.Wallet;
  const payer = wallet.payer;

  // 推导两个 PDA：vault (lamport 容器) + vault_state (关联账户)
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), wallet.publicKey.toBuffer()],
    program.programId
  );
  const [vaultStatePda, vaultStateBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state"), wallet.publicKey.toBuffer()],
    program.programId
  );

  const fakeUser = Keypair.generate();

  it("initializes the vault", async () => {
    // 用 init 约束自动创建 vault PDA + vault_state
    await program.methods
      .initializeVault()
      .accounts({
        vault: vaultPda,
        vaultState: vaultStatePda,
        user: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const account = await program.account.vaultState.fetch(vaultStatePda);
    assert.ok(account.authority.equals(wallet.publicKey));
    assert.strictEqual(account.bump, vaultStateBump);
  });

  it("deposits SOL into the vault", async () => {
    const depositAmount = 1 * LAMPORTS_PER_SOL;
    const beforeBalance = await provider.connection.getBalance(vaultPda);

    await program.methods
      .deposit(new anchor.BN(depositAmount))
      .accounts({
        vault: vaultPda,
        vaultState: vaultStatePda,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const afterBalance = await provider.connection.getBalance(vaultPda);
    assert.ok(afterBalance > beforeBalance);
  });

  it("withdraws SOL from the vault", async () => {
    const withdrawAmount = 0.5 * LAMPORTS_PER_SOL;
    const beforeBalance = await provider.connection.getBalance(
      wallet.publicKey
    );
    const beforeVaultBalance = await provider.connection.getBalance(vaultPda);

    await program.methods
      .withdraw(new anchor.BN(withdrawAmount))
      .accounts({
        vault: vaultPda,
        vaultState: vaultStatePda,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const afterBalance = await provider.connection.getBalance(wallet.publicKey);
    const afterVaultBalance = await provider.connection.getBalance(vaultPda);

    assert.ok(afterBalance > beforeBalance);
    assert.ok(afterVaultBalance < beforeVaultBalance);
  });

  it("fails when non-authority tries to withdraw", async () => {
    const airdropSig = await provider.connection.requestAirdrop(
      fakeUser.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    try {
      await program.methods
        .withdraw(new anchor.BN(0.1 * LAMPORTS_PER_SOL))
        .accounts({
          vault: vaultPda,
          vaultState: vaultStatePda,
          authority: wallet.publicKey, // PDA seeds 用的
          systemProgram: SystemProgram.programId,
        })
        .signers([fakeUser]) // 但 fakeUser 没权签 wallet
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      assert.ok(err);
    }
  });

  it("fails when withdrawing more than balance", async () => {
    const vaultBalance = await provider.connection.getBalance(vaultPda);
    const tooMuch = vaultBalance + 10 * LAMPORTS_PER_SOL;

    try {
      await program.methods
        .withdraw(new anchor.BN(tooMuch))
        .accounts({
          vault: vaultPda,
          vaultState: vaultStatePda,
          authority: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      assert.instanceOf(err, AnchorError);
      const anchorErr = err as AnchorError;
      assert.strictEqual(anchorErr.error.errorCode.code, "InsufficientFunds");
    }
  });
});
