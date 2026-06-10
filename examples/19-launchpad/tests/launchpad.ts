import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Launchpad } from "../target/types/launchpad";
import { assert } from "chai";
import { PublicKey, Keypair, Transaction } from "@solana/web3.js";
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

describe("launchpad", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.launchpad as Program<Launchpad>;
  const authority = (provider.wallet as anchor.Wallet).payer;

  let saleMint: PublicKey;
  let quoteMint: PublicKey;
  let authoritySaleAta: PublicKey;
  let authorityQuoteAta: PublicKey;

  // pool1: succeed path
  let pool1Pda: PublicKey;
  let pool1SaleVault: PublicKey;
  let pool1QuoteVault: PublicKey;
  // pool2: refund + withdraw_sale path
  let pool2Pda: PublicKey;
  let pool2SaleVault: PublicKey;
  let pool2QuoteVault: PublicKey;

  const PRICE = 100n; // 1 quote = 100 sale
  const SOFT_CAP_1 = 50_000_000n; // 50 quote (6 decimals)
  const HARD_CAP_1 = 200_000_000n; // 200 quote
  const SALE_DEPOSIT_1 = 100_000_000_000n; // 100,000 sale (9 decimals for differentiation, but use 6 for simplicity)

  const SOFT_CAP_2 = 100_000_000n; // 100 quote
  const HARD_CAP_2 = 200_000_000n;
  const SALE_DEPOSIT_2 = 100_000_000_000n;

  before(async () => {
    // 两个 mint
    saleMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6
    );
    quoteMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6
    );

    // authority 的两个 ATA
    const sAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority,
      saleMint,
      authority.publicKey
    );
    authoritySaleAta = sAta.address;
    await mintTo(
      provider.connection,
      authority,
      saleMint,
      authoritySaleAta,
      authority,
      1_000_000_000_000n // 1B sale token 给 authority
    );

    const qAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority,
      quoteMint,
      authority.publicKey
    );
    authorityQuoteAta = qAta.address;
    await mintTo(
      provider.connection,
      authority,
      quoteMint,
      authorityQuoteAta,
      authority,
      1_000_000_000_000n // 1B quote token
    );

    // pool1 PDA
    [pool1Pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        authority.publicKey.toBuffer(),
        saleMint.toBuffer(),
        quoteMint.toBuffer(),
      ],
      program.programId
    );
    [pool1SaleVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("sale_vault"), pool1Pda.toBuffer()],
      program.programId
    );
    [pool1QuoteVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("quote_vault"), pool1Pda.toBuffer()],
      program.programId
    );

    // pool2 PDA - 使用不同 authority 以避免 seeds 冲突
    // 不过我们的 seeds 是 (authority, sale_mint, quote_mint)，
    // 同一 authority+sale+quote 只能有一个 pool。
    // 测试中我们用同一个 pool1 测试 refund 失败路径，
    // 但需要构造一个能 refund 的 pool。
    // 改用不同 authority 创 pool2
    const altAuthority = Keypair.generate();
    // 给 altAuthority 转 SOL
    const sig = await provider.connection.requestAirdrop(
      altAuthority.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    // altAuthority 也要有 saleMint / quoteMint 的 ATA 且有 token
    const altSaleAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        altAuthority,
        saleMint,
        altAuthority.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      authority,
      saleMint,
      altSaleAta,
      authority,
      1_000_000_000_000n
    );
    const altQuoteAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        altAuthority,
        quoteMint,
        altAuthority.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      authority,
      quoteMint,
      altQuoteAta,
      authority,
      1_000_000_000_000n
    );

    [pool2Pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        altAuthority.publicKey.toBuffer(),
        saleMint.toBuffer(),
        quoteMint.toBuffer(),
      ],
      program.programId
    );
    [pool2SaleVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("sale_vault"), pool2Pda.toBuffer()],
      program.programId
    );
    [pool2QuoteVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("quote_vault"), pool2Pda.toBuffer()],
      program.programId
    );

    // 存 altAuthority 引用供后续 test 用
    (global as any).__altAuthority = altAuthority;
  });

  async function airdropSol(to: PublicKey, sol: number) {
    const sig = await provider.connection.requestAirdrop(
      to,
      sol * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
  }

  function nowSeconds(offset = 0): number {
    return Math.floor(Date.now() / 1000) + offset;
  }

  async function sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function ensureAta(
    owner: Keypair,
    mint: PublicKey
  ): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(mint, owner.publicKey);
    if (!(await provider.connection.getAccountInfo(ata))) {
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          owner.publicKey,
          ata,
          owner.publicKey,
          mint
        )
      );
      await provider.sendAndConfirm(tx, [owner]);
    }
    // 给 quoteMint 转入 token
    if (mint.equals(quoteMint)) {
      await mintTo(
        provider.connection,
        authority,
        quoteMint,
        ata,
        authority,
        1_000_000_000_000n
      );
    }
    return ata;
  }

  it("creates pool successfully", async () => {
    await program.methods
      .createPool(
        new anchor.BN(PRICE.toString()),
        new anchor.BN(SOFT_CAP_1.toString()),
        new anchor.BN(HARD_CAP_1.toString()),
        new anchor.BN(0), // start_time
        new anchor.BN(1_000_000_000_000) // end_time far future
      )
      .accounts({
        saleMint,
        quoteMint,
        authority: authority.publicKey,
      })
      .rpc();

    const pool = await program.account.launchpadPool.fetch(pool1Pda);
    assert.strictEqual(
      pool.authority.toBase58(),
      authority.publicKey.toBase58()
    );
    assert.strictEqual(pool.saleMint.toBase58(), saleMint.toBase58());
    assert.strictEqual(pool.quoteMint.toBase58(), quoteMint.toBase58());
    assert.strictEqual(pool.softCap.toString(), SOFT_CAP_1.toString());
    assert.strictEqual(pool.hardCap.toString(), HARD_CAP_1.toString());
    assert.strictEqual(pool.status, 0); // Active
  });

  it("deposits sale token to vault", async () => {
    await program.methods
      .depositSaleToken(new anchor.BN(SALE_DEPOSIT_1.toString()))
      .accounts({
        pool: pool1Pda,
        saleVault: pool1SaleVault,
        authoritySaleAta,
        authority: authority.publicKey,
      })
      .rpc();

    const vault = await getAccount(provider.connection, pool1SaleVault);
    assert.strictEqual(vault.amount, SALE_DEPOSIT_1);
  });

  it("user contributes and reaches soft cap", async () => {
    const alice = Keypair.generate();
    await airdropSol(alice.publicKey, 2);
    const aliceQuoteAta = await ensureAta(alice, quoteMint);

    const aliceContribPda = PublicKey.findProgramAddressSync(
      [
        Buffer.from("contribution"),
        pool1Pda.toBuffer(),
        alice.publicKey.toBuffer(),
      ],
      program.programId
    )[0];

    // Alice 投 60 quote (60_000_000) → soft_cap=50_000_000 达成
    const contributeAmount = 60_000_000n;

    await program.methods
      .contribute(new anchor.BN(contributeAmount.toString()))
      .accounts({
        pool: pool1Pda,
        saleVault: pool1SaleVault,
        contribution: aliceContribPda,
        userQuoteAta: aliceQuoteAta,
        user: alice.publicKey,
      })
      .signers([alice])
      .rpc();

    const pool = await program.account.launchpadPool.fetch(pool1Pda);
    assert.strictEqual(
      pool.totalQuoteRaised.toString(),
      contributeAmount.toString()
    );

    const quoteVault = await getAccount(provider.connection, pool1QuoteVault);
    assert.strictEqual(quoteVault.amount, contributeAmount);

    const contrib = await program.account.userContribution.fetch(
      aliceContribPda
    );
    assert.strictEqual(
      contrib.quoteAmount.toString(),
      contributeAmount.toString()
    );
    assert.strictEqual(
      contrib.saleAmount.toString(),
      (contributeAmount * PRICE).toString()
    );
  });

  it("rejects contribute when amount exceeds hard cap", async () => {
    // pool1 已经 raise 了 60 quote，hard cap = 200
    // 尝试投 150 应该是 150+60=210 > 200 失败
    const carol = Keypair.generate();
    await airdropSol(carol.publicKey, 2);
    const carolQuoteAta = await ensureAta(carol, quoteMint);

    const carolContribPda = PublicKey.findProgramAddressSync(
      [
        Buffer.from("contribution"),
        pool1Pda.toBuffer(),
        carol.publicKey.toBuffer(),
      ],
      program.programId
    )[0];

    const overHardCap = 150_000_000n; // 150 quote; 60 + 150 = 210 > 200
    try {
      await program.methods
        .contribute(new anchor.BN(overHardCap.toString()))
        .accounts({
          pool: pool1Pda,
          saleVault: pool1SaleVault,
          contribution: carolContribPda,
          userQuoteAta: carolQuoteAta,
          user: carol.publicKey,
        })
        .signers([carol])
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      assert.match(err.toString(), /OverHardCap/);
    }
  });

  it("rejects contribute after sale ended", async () => {
    const endedAuthority = Keypair.generate();
    await airdropSol(endedAuthority.publicKey, 2);

    const endedAuthoritySaleAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        endedAuthority,
        saleMint,
        endedAuthority.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      authority,
      saleMint,
      endedAuthoritySaleAta,
      authority,
      1_000_000_000_000n
    );

    const [endedPool] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        endedAuthority.publicKey.toBuffer(),
        saleMint.toBuffer(),
        quoteMint.toBuffer(),
      ],
      program.programId
    );
    const [endedSaleVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("sale_vault"), endedPool.toBuffer()],
      program.programId
    );

    await program.methods
      .createPool(
        new anchor.BN(PRICE.toString()),
        new anchor.BN(SOFT_CAP_2.toString()),
        new anchor.BN(HARD_CAP_2.toString()),
        new anchor.BN(0),
        new anchor.BN(1)
      )
      .accounts({
        saleMint,
        quoteMint,
        authority: endedAuthority.publicKey,
      })
      .signers([endedAuthority])
      .rpc();

    await program.methods
      .depositSaleToken(new anchor.BN(SALE_DEPOSIT_2.toString()))
      .accounts({
        pool: endedPool,
        saleVault: endedSaleVault,
        authoritySaleAta: endedAuthoritySaleAta,
        authority: endedAuthority.publicKey,
      })
      .signers([endedAuthority])
      .rpc();

    const dave = Keypair.generate();
    await airdropSol(dave.publicKey, 2);
    const daveQuoteAta = await ensureAta(dave, quoteMint);
    const daveContribPda = PublicKey.findProgramAddressSync(
      [
        Buffer.from("contribution"),
        endedPool.toBuffer(),
        dave.publicKey.toBuffer(),
      ],
      program.programId
    )[0];

    try {
      await program.methods
        .contribute(new anchor.BN(10_000_000))
        .accounts({
          pool: endedPool,
          saleVault: endedSaleVault,
          contribution: daveContribPda,
          userQuoteAta: daveQuoteAta,
          user: dave.publicKey,
        })
        .signers([dave])
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      assert.match(err.toString(), /Ended/);
    }
  });

  it("user claims sale token after soft cap", async () => {
    const alice = Keypair.generate();
    await airdropSol(alice.publicKey, 2);
    const aliceQuoteAta = await ensureAta(alice, quoteMint);
    const aliceSaleAta = await ensureAta(alice, saleMint);

    const aliceContribPda = PublicKey.findProgramAddressSync(
      [
        Buffer.from("contribution"),
        pool1Pda.toBuffer(),
        alice.publicKey.toBuffer(),
      ],
      program.programId
    )[0];

    // Bob 也投 5 quote (5_000_000)，保证总 = 65 远超 soft cap
    const contributeAmount = 5_000_000n;

    await program.methods
      .contribute(new anchor.BN(contributeAmount.toString()))
      .accounts({
        pool: pool1Pda,
        saleVault: pool1SaleVault,
        contribution: aliceContribPda,
        userQuoteAta: aliceQuoteAta,
        user: alice.publicKey,
      })
      .signers([alice])
      .rpc();

    await program.methods
      .claim()
      .accounts({
        pool: pool1Pda,
        saleVault: pool1SaleVault,
        contribution: aliceContribPda,
        userSaleAta: aliceSaleAta,
        user: alice.publicKey,
      })
      .signers([alice])
      .rpc();

    const userSaleBalance = await getAccount(provider.connection, aliceSaleAta);
    assert.strictEqual(userSaleBalance.amount, contributeAmount * PRICE);

    const contrib = await program.account.userContribution.fetch(
      aliceContribPda
    );
    assert.isTrue(contrib.claimed);
  });

  it("rejects claim when soft cap not reached, supports refund path", async () => {
    // 准备 pool2（用 altAuthority）
    const altAuthority = (global as any).__altAuthority as Keypair;

    const pool2EndTime = nowSeconds(5);

    // 用 altAuthority 建 pool2，先验证结束前不可退款，再等到 end_time 后退款
    await program.methods
      .createPool(
        new anchor.BN(PRICE.toString()),
        new anchor.BN(SOFT_CAP_2.toString()),
        new anchor.BN(HARD_CAP_2.toString()),
        new anchor.BN(0),
        new anchor.BN(pool2EndTime)
      )
      .accounts({
        saleMint,
        quoteMint,
        authority: altAuthority.publicKey,
      })
      .signers([altAuthority])
      .rpc();

    // 存入 sale token
    await program.methods
      .depositSaleToken(new anchor.BN(SALE_DEPOSIT_2.toString()))
      .accounts({
        pool: pool2Pda,
        saleVault: pool2SaleVault,
        authoritySaleAta: (
          await getOrCreateAssociatedTokenAccount(
            provider.connection,
            altAuthority,
            saleMint,
            altAuthority.publicKey
          )
        ).address,
        authority: altAuthority.publicKey,
      })
      .signers([altAuthority])
      .rpc();

    // Bob 投 30 quote (未达 soft_cap=100)
    const bob = Keypair.generate();
    await airdropSol(bob.publicKey, 2);
    const bobQuoteAta = await ensureAta(bob, quoteMint);

    const bobContribPda = PublicKey.findProgramAddressSync(
      [
        Buffer.from("contribution"),
        pool2Pda.toBuffer(),
        bob.publicKey.toBuffer(),
      ],
      program.programId
    )[0];

    const contributeAmount = 30_000_000n;
    await program.methods
      .contribute(new anchor.BN(contributeAmount.toString()))
      .accounts({
        pool: pool2Pda,
        saleVault: pool2SaleVault,
        contribution: bobContribPda,
        userQuoteAta: bobQuoteAta,
        user: bob.publicKey,
      })
      .signers([bob])
      .rpc();

    // 验证 total < soft_cap
    const pool = await program.account.launchpadPool.fetch(pool2Pda);
    assert.isBelow(Number(pool.totalQuoteRaised), Number(pool.softCap));

    // 尝试 claim 应失败（soft cap 未达到）
    const bobSaleAta = await ensureAta(bob, saleMint);
    try {
      await program.methods
        .claim()
        .accounts({
          pool: pool2Pda,
          saleVault: pool2SaleVault,
          contribution: bobContribPda,
          userSaleAta: bobSaleAta,
          user: bob.publicKey,
        })
        .signers([bob])
        .rpc();
      assert.fail("claim should have failed");
    } catch (err: any) {
      assert.match(err.toString(), /NotSucceeded/);
    }

    // 结束前 refund 应失败
    try {
      await program.methods
        .refund()
        .accounts({
          pool: pool2Pda,
          quoteVault: pool2QuoteVault,
          contribution: bobContribPda,
          userQuoteAta: bobQuoteAta,
          user: bob.publicKey,
        })
        .signers([bob])
        .rpc();
      assert.fail("refund should have failed before end_time");
    } catch (err: any) {
      assert.match(err.toString(), /NotEnded/);
    }

    await sleep(5_000);

    // end_time 后 refund 成功
    await program.methods
      .refund()
      .accounts({
        pool: pool2Pda,
        quoteVault: pool2QuoteVault,
        contribution: bobContribPda,
        userQuoteAta: bobQuoteAta,
        user: bob.publicKey,
      })
      .signers([bob])
      .rpc();

    const bobQuoteBalance = await getAccount(provider.connection, bobQuoteAta);
    // Bob 收到 30 quote refund
    // 实际初始给了他 1_000_000_000_000，转账走了 30_000_000，refund 后回到原值
    assert.strictEqual(bobQuoteBalance.amount, 1_000_000_000_000n);

    const contrib = await program.account.userContribution.fetch(bobContribPda);
    assert.isTrue(contrib.refunded);
  });

  it("rejects non-authority withdraw", async () => {
    // 仍然在 pool2 上，pool 已 Failed (Bob refund 后 status=2)
    const pool2State = await program.account.launchpadPool.fetch(pool2Pda);
    assert.strictEqual(pool2State.status, 2); // Failed

    // 用一个非 authority 用户尝试 withdraw
    const attacker = Keypair.generate();
    await airdropSol(attacker.publicKey, 2);
    const attackerSaleAta = await ensureAta(attacker, saleMint);
    const attackerQuoteAta = await ensureAta(attacker, quoteMint);

    try {
      await program.methods
        .withdraw()
        .accounts({
          pool: pool2Pda,
          quoteVault: pool2QuoteVault,
          saleVault: pool2SaleVault,
          authorityQuoteAta: attackerQuoteAta,
          authoritySaleAta: attackerSaleAta,
          authority: attacker.publicKey,
        })
        .signers([attacker])
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      // 期望：authority 不匹配 (ConstraintHasOne)
      // 错误信息里会包含 seeds / has_one / authority 关键词
      assert.match(err.toString(), /authority|has_one|seeds|constraint/i);
    }
  });
});
