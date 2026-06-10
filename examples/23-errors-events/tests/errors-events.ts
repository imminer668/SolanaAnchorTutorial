import * as anchor from "@coral-xyz/anchor";
import { AnchorError, Program } from "@coral-xyz/anchor";
import { ErrorsEvents } from "../target/types/errors_events";
import { assert } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";

describe("errors_events", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.errorsEvents as Program<ErrorsEvents>;

  function boardPdaFor(authority: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("board"), authority.toBuffer()],
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

  async function transactionLogs(signature: string): Promise<string[]> {
    let tx = await provider.connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    for (let i = 0; i < 10 && !tx; i++) {
      await sleep(500);
      tx = await provider.connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
    }

    assert.isNotNull(tx);
    return tx!.meta?.logMessages ?? [];
  }

  function decodedEvents(logs: string[]) {
    return logs
      .filter((log) => log.startsWith("Program data: "))
      .map((log) => log.replace("Program data: ", ""))
      .map((data) => program.coder.events.decode(data))
      .filter((event): event is NonNullable<typeof event> => event !== null);
  }

  async function initializeBoard(authority: Keypair): Promise<PublicKey> {
    await airdropSol(authority.publicKey);
    const board = boardPdaFor(authority.publicKey);

    await program.methods
      .initialize()
      .accounts({ board, authority: authority.publicKey })
      .signers([authority])
      .rpc();

    return board;
  }

  it("records value and decodes emitted event", async () => {
    const authority = Keypair.generate();
    const board = await initializeBoard(authority);

    const signature = await program.methods
      .recordValue(new anchor.BN(42))
      .accounts({ board, authority: authority.publicKey })
      .signers([authority])
      .rpc();

    const account = await program.account.board.fetch(board);
    assert.strictEqual(
      account.authority.toBase58(),
      authority.publicKey.toBase58()
    );
    assert.strictEqual(account.value.toString(), "42");

    const events = decodedEvents(await transactionLogs(signature));
    const recorded = events.find((event) => event.name === "valueRecorded");

    assert.isDefined(recorded);
    assert.strictEqual(recorded!.data.board.toBase58(), board.toBase58());
    assert.strictEqual(
      recorded!.data.authority.toBase58(),
      authority.publicKey.toBase58()
    );
    assert.strictEqual(recorded!.data.previousValue.toString(), "0");
    assert.strictEqual(recorded!.data.value.toString(), "42");
  });

  it("rejects zero value with InvalidValue error", async () => {
    const authority = Keypair.generate();
    const board = await initializeBoard(authority);

    try {
      await program.methods
        .recordValue(new anchor.BN(0))
        .accounts({ board, authority: authority.publicKey })
        .signers([authority])
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      assert.isTrue(err instanceof AnchorError);
      assert.strictEqual(err.error.errorCode.code, "InvalidValue");
      assert.strictEqual(err.error.errorCode.number, 6000);
    }
  });

  it("rejects oversized value with ValueTooLarge error", async () => {
    const authority = Keypair.generate();
    const board = await initializeBoard(authority);

    try {
      await program.methods
        .recordValue(new anchor.BN(101))
        .accounts({ board, authority: authority.publicKey })
        .signers([authority])
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      assert.isTrue(err instanceof AnchorError);
      assert.strictEqual(err.error.errorCode.code, "ValueTooLarge");
      assert.strictEqual(err.error.errorCode.number, 6001);
    }
  });

  it("rejects non-authority signer with Unauthorized error", async () => {
    const authority = Keypair.generate();
    const attacker = Keypair.generate();
    const board = await initializeBoard(authority);

    try {
      await program.methods
        .recordValue(new anchor.BN(7))
        .accounts({ board, authority: attacker.publicKey })
        .signers([attacker])
        .rpc();
      assert.fail("should have failed");
    } catch (err: any) {
      assert.isTrue(err instanceof AnchorError);
      assert.strictEqual(err.error.errorCode.code, "Unauthorized");
      assert.strictEqual(err.error.errorCode.number, 6002);
    }
  });
});
