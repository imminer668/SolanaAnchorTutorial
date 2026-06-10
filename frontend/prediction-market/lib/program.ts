import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import predictionMarketIdl from "./idl/prediction_market.json";

export const PREDICTION_MARKET_PROGRAM_ID = new PublicKey(
  "Dz6GHpezahf3zoHwdBqpaGNNuRwqx15K1hoyvSm2Zmfz",
);

export function getPredictionMarketProgram(
  connection: Connection,
  wallet: AnchorWallet,
): Program<Idl> {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  return new Program(predictionMarketIdl as Idl, provider);
}

function u64Seed(value: string) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

export function deriveMarket(authority: PublicKey, quoteMint: PublicKey, marketId: string) {
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), authority.toBuffer(), quoteMint.toBuffer(), u64Seed(marketId)],
    PREDICTION_MARKET_PROGRAM_ID,
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()],
    PREDICTION_MARKET_PROGRAM_ID,
  );
  return { market, vault };
}

export function derivePosition(market: PublicKey, user: PublicKey) {
  const [position] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), user.toBuffer()],
    PREDICTION_MARKET_PROGRAM_ID,
  );
  return position;
}
