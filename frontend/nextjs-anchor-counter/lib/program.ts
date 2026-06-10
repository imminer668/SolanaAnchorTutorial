import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import counterIdl from "./idl/counter.json";

export const COUNTER_PROGRAM_ID = new PublicKey(
  "4ZBoKY6WTDBTKbRZuqnWALwCBMr54Zitq3pVdTckziby",
);

export function getCounterProgram(
  connection: Connection,
  wallet: AnchorWallet,
): Program<Idl> {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  return new Program(counterIdl as Idl, provider);
}
