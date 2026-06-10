import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Voting } from "../target/types/voting";
import { assert } from "chai";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";

describe("voting", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.voting as Program<Voting>;
  const authority = (provider.wallet as anchor.Wallet).payer;

  const pollId = Date.now();
  const title = `Best L1 ${Date.now()}`;
  const options = ["Solana", "Ethereum", "Aptos"];

  let pollPda: PublicKey;
  let pollBump: number;

  function u64Le(value: number): Buffer {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(BigInt(value));
    return buffer;
  }

  before(() => {
    [pollPda, pollBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("poll"), authority.publicKey.toBuffer(), u64Le(pollId)],
      program.programId
    );
  });

  function deriveVoteRecord(voter: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("vote"), pollPda.toBuffer(), voter.toBuffer()],
      program.programId
    );
  }

  async function airdrop(to: PublicKey, sol: number) {
    const sig = await provider.connection.requestAirdrop(
      to,
      sol * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
  }

  it("creates a poll", async () => {
    await program.methods
      .createPoll(new anchor.BN(pollId), title, options, new anchor.BN(3600))
      .accounts({
        authority: authority.publicKey,
      })
      .rpc();

    const poll = await program.account.poll.fetch(pollPda);
    assert.strictEqual(poll.title, title);
    assert.deepStrictEqual(poll.options, options);
    assert.strictEqual(poll.voteCounts.length, options.length);
    assert.strictEqual(poll.closed, false);
    assert.ok(poll.authority.equals(authority.publicKey));
  });

  it("votes successfully", async () => {
    const [voteRecord] = deriveVoteRecord(authority.publicKey);
    await program.methods
      .vote(0)
      .accounts({
        poll: pollPda,
        voter: authority.publicKey,
      })
      .rpc();

    const poll = await program.account.poll.fetch(pollPda);
    assert.strictEqual(poll.voteCounts[0].toNumber(), 1);

    const rec = await program.account.voteRecord.fetch(voteRecord);
    assert.strictEqual(rec.optionIndex, 0);
    assert.ok(rec.voter.equals(authority.publicKey));
  });

  it("rejects double vote from same voter", async () => {
    try {
      await program.methods
        .vote(1)
        .accounts({
          poll: pollPda,
          voter: authority.publicKey,
        })
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      // init 失败：账户已存在
      assert.match(
        err.toString(),
        /already in use|already exists|0x0/i,
        `unexpected error: ${err}`
      );
    }
  });

  it("rejects invalid option index", async () => {
    const other = Keypair.generate();
    await airdrop(other.publicKey, 1);

    try {
      await program.methods
        .vote(99)
        .accounts({
          poll: pollPda,
          voter: other.publicKey,
        })
        .signers([other])
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      assert.match(err.toString(), /InvalidOption/);
    }
  });

  it("closes the poll", async () => {
    await program.methods
      .closePoll()
      .accounts({
        poll: pollPda,
        authority: authority.publicKey,
      })
      .rpc();

    const poll = await program.account.poll.fetch(pollPda);
    assert.strictEqual(poll.closed, true);
  });

  it("rejects vote after close", async () => {
    const other = Keypair.generate();
    await airdrop(other.publicKey, 1);

    try {
      await program.methods
        .vote(2)
        .accounts({
          poll: pollPda,
          voter: other.publicKey,
        })
        .signers([other])
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      assert.match(err.toString(), /PollClosed/);
    }
  });

  it("rejects close from non-authority", async () => {
    const otherPollId = pollId + 1;
    const otherTitle = `Other ${Date.now()}`;
    const [otherPoll] = PublicKey.findProgramAddressSync(
      [Buffer.from("poll"), authority.publicKey.toBuffer(), u64Le(otherPollId)],
      program.programId
    );

    await program.methods
      .createPoll(
        new anchor.BN(otherPollId),
        otherTitle,
        ["A", "B"],
        new anchor.BN(3600)
      )
      .accounts({
        authority: authority.publicKey,
      })
      .rpc();

    const attacker = Keypair.generate();
    await airdrop(attacker.publicKey, 1);

    try {
      await program.methods
        .closePoll()
        .accounts({
          poll: otherPoll,
          authority: attacker.publicKey,
        })
        .signers([attacker])
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      assert.match(
        err.toString(),
        /seeds constraint|ConstraintSeeds|has_one|Unauthorized/
      );
    }
  });
});
