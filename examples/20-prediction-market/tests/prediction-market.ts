import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PredictionMarket } from "../target/types/prediction_market";
import { assert } from "chai";
import { PublicKey, Keypair, Transaction } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

describe("prediction_market", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .predictionMarket as Program<PredictionMarket>;
  const authority = (provider.wallet as anchor.Wallet).payer;

  let quoteMint: PublicKey;
  let authorityQuoteAta: PublicKey;

  let marketPda: PublicKey;
  let vaultPda: PublicKey;
  let marketEndTime: number;

  const QUESTION = "Will BTC > 100k by EOY?";
  const MARKET_ID = Date.now();
  const OUTCOME_A = 1;
  const OUTCOME_B = 2;

  // 用于跨 it() 共享 keypair
  let alice: Keypair;
  let bob: Keypair;
  let aliceAta: PublicKey;
  let bobAta: PublicKey;

  function u64Le(value: number): Buffer {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(BigInt(value));
    return buffer;
  }

  function nowSeconds(offset = 0): number {
    return Math.floor(Date.now() / 1000) + offset;
  }

  async function sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  before(async () => {
    quoteMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6
    );

    const ata = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority,
      quoteMint,
      authority.publicKey
    );
    authorityQuoteAta = ata.address;
    await mintTo(
      provider.connection,
      authority,
      quoteMint,
      authorityQuoteAta,
      authority,
      1_000_000_000_000n
    );

    [marketPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("market"),
        authority.publicKey.toBuffer(),
        quoteMint.toBuffer(),
        u64Le(MARKET_ID),
      ],
      program.programId
    );
    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), marketPda.toBuffer()],
      program.programId
    );

    // 预先生成 alice/bob 并空投 SOL
    alice = Keypair.generate();
    bob = Keypair.generate();
    await airdropSol(alice.publicKey, 2);
    await airdropSol(bob.publicKey, 2);

    aliceAta = await setupUser(alice);
    bobAta = await setupUser(bob);
  });

  async function airdropSol(to: PublicKey, sol: number) {
    const sig = await provider.connection.requestAirdrop(
      to,
      sol * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
  }

  async function setupUser(user: Keypair): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(quoteMint, user.publicKey);
    if (!(await provider.connection.getAccountInfo(ata))) {
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          user.publicKey,
          ata,
          user.publicKey,
          quoteMint
        )
      );
      await provider.sendAndConfirm(tx, [user]);
    }
    await mintTo(
      provider.connection,
      authority,
      quoteMint,
      ata,
      authority,
      1_000_000_000_000n
    );
    return ata;
  }

  function positionPdaFor(user: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("position"), marketPda.toBuffer(), user.toBuffer()],
      program.programId
    )[0];
  }

  it("creates market successfully", async () => {
    marketEndTime = nowSeconds(3);

    await program.methods
      .createMarket(
        new anchor.BN(MARKET_ID),
        QUESTION,
        new anchor.BN(marketEndTime)
      )
      .accounts({
        quoteMint,
        authority: authority.publicKey,
      })
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    assert.strictEqual(
      market.authority.toBase58(),
      authority.publicKey.toBase58()
    );
    assert.strictEqual(market.question, QUESTION);
    assert.strictEqual(market.resolved, false);
    assert.strictEqual(market.totalA.toString(), "0");
    assert.strictEqual(market.totalB.toString(), "0");
  });

  it("rejects market creation with past end time", async () => {
    try {
      await program.methods
        .createMarket(
          new anchor.BN(MARKET_ID + 100),
          "Past market",
          new anchor.BN(1)
        )
        .accounts({
          quoteMint,
          authority: authority.publicKey,
        })
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      assert.match(err.toString(), /InvalidTime/);
    }
  });

  it("places bets on both outcomes", async () => {
    // Alice 投 60 到 OutcomeA
    await program.methods
      .placeBet(OUTCOME_A, new anchor.BN(60_000_000))
      .accounts({
        market: marketPda,
        vault: vaultPda,
        position: positionPdaFor(alice.publicKey),
        userQuoteAta: aliceAta,
        user: alice.publicKey,
      })
      .signers([alice])
      .rpc();

    // Bob 投 40 到 OutcomeB
    await program.methods
      .placeBet(OUTCOME_B, new anchor.BN(40_000_000))
      .accounts({
        market: marketPda,
        vault: vaultPda,
        position: positionPdaFor(bob.publicKey),
        userQuoteAta: bobAta,
        user: bob.publicKey,
      })
      .signers([bob])
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    assert.strictEqual(market.totalA.toString(), "60000000");
    assert.strictEqual(market.totalB.toString(), "40000000");

    const vault = await getAccount(provider.connection, vaultPda);
    assert.strictEqual(vault.amount, 100_000_000n);
  });

  it("rejects bet after market end time", async () => {
    const endedMarketId = MARKET_ID + 101;
    const endedMarketEndTime = nowSeconds(1);
    const [endedMarket] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("market"),
        authority.publicKey.toBuffer(),
        quoteMint.toBuffer(),
        u64Le(endedMarketId),
      ],
      program.programId
    );
    const [endedVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), endedMarket.toBuffer()],
      program.programId
    );

    await program.methods
      .createMarket(
        new anchor.BN(endedMarketId),
        "Closed to bets",
        new anchor.BN(endedMarketEndTime)
      )
      .accounts({
        quoteMint,
        authority: authority.publicKey,
      })
      .rpc();

    await sleep(2_000);

    const eve = Keypair.generate();
    await airdropSol(eve.publicKey, 2);
    const eveAta = await setupUser(eve);
    const [evePosition] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        endedMarket.toBuffer(),
        eve.publicKey.toBuffer(),
      ],
      program.programId
    );

    try {
      await program.methods
        .placeBet(OUTCOME_A, new anchor.BN(10_000_000))
        .accounts({
          market: endedMarket,
          vault: endedVault,
          position: evePosition,
          userQuoteAta: eveAta,
          user: eve.publicKey,
        })
        .signers([eve])
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      assert.match(err.toString(), /Ended/);
    }
  });

  it("rejects invalid outcome in resolve", async () => {
    try {
      await program.methods
        .resolve(new anchor.BN(99))
        .accounts({
          market: marketPda,
          authority: authority.publicKey,
        })
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      assert.match(err.toString(), /InvalidOutcome/);
    }
  });

  it("resolves market with winning outcome A", async () => {
    await sleep(Math.max(0, marketEndTime - nowSeconds()) * 1000 + 1_000);

    await program.methods
      .resolve(new anchor.BN(OUTCOME_A))
      .accounts({
        market: marketPda,
        authority: authority.publicKey,
      })
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    assert.strictEqual(market.resolved, true);
    assert.strictEqual(market.winningOutcome, OUTCOME_A);
  });

  it("rejects resolve on already-resolved market", async () => {
    try {
      await program.methods
        .resolve(new anchor.BN(OUTCOME_A))
        .accounts({
          market: marketPda,
          authority: authority.publicKey,
        })
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      assert.match(err.toString(), /AlreadyResolved/);
    }
  });

  it("winner claims full pool", async () => {
    // Alice 是赢家 (OutcomeA)，投 60，total_a = 60, total_pool = 100
    // 奖励 = 60/60 * 100 = 100
    await program.methods
      .claim()
      .accounts({
        market: marketPda,
        vault: vaultPda,
        position: positionPdaFor(alice.publicKey),
        userQuoteAta: aliceAta,
        user: alice.publicKey,
      })
      .signers([alice])
      .rpc();

    const aliceBalance = await getAccount(provider.connection, aliceAta);
    // Alice 初始 1T, 投了 60M, 赢了 100M → 净 + 40M
    assert.strictEqual(
      aliceBalance.amount,
      1_000_000_000_000n - 60_000_000n + 100_000_000n
    );

    const position = await program.account.position.fetch(
      positionPdaFor(alice.publicKey)
    );
    assert.isTrue(position.claimed);
  });

  it("loser cannot claim", async () => {
    // Bob 投了 B，A 赢 → bob 拿不到
    try {
      await program.methods
        .claim()
        .accounts({
          market: marketPda,
          vault: vaultPda,
          position: positionPdaFor(bob.publicKey),
          userQuoteAta: bobAta,
          user: bob.publicKey,
        })
        .signers([bob])
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      assert.match(err.toString(), /Lost/);
    }
  });

  it("rejects claim before resolve", async () => {
    // 用一个新 market，未 resolve
    const marketId2 = MARKET_ID + 1;
    const question2 = "Will ETH flip BTC?";
    const [market2Pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("market"),
        authority.publicKey.toBuffer(),
        quoteMint.toBuffer(),
        u64Le(marketId2),
      ],
      program.programId
    );
    const [vault2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), market2Pda.toBuffer()],
      program.programId
    );

    await program.methods
      .createMarket(
        new anchor.BN(marketId2),
        question2,
        new anchor.BN(9_000_000_000)
      )
      .accounts({
        quoteMint,
        authority: authority.publicKey,
      })
      .rpc();

    const carol = Keypair.generate();
    await airdropSol(carol.publicKey, 2);
    const carolAta = await setupUser(carol);

    const carolPositionPda = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        market2Pda.toBuffer(),
        carol.publicKey.toBuffer(),
      ],
      program.programId
    )[0];

    await program.methods
      .placeBet(OUTCOME_A, new anchor.BN(10_000_000))
      .accounts({
        market: market2Pda,
        vault: vault2Pda,
        position: carolPositionPda,
        userQuoteAta: carolAta,
        user: carol.publicKey,
      })
      .signers([carol])
      .rpc();

    // 立即尝试 claim (未 resolve)
    try {
      await program.methods
        .claim()
        .accounts({
          market: market2Pda,
          vault: vault2Pda,
          position: carolPositionPda,
          userQuoteAta: carolAta,
          user: carol.publicKey,
        })
        .signers([carol])
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      assert.match(err.toString(), /NotResolved/);
    }
  });
});
