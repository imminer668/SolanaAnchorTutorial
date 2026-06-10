import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import launchpadIdl from "./idl/launchpad.json";

export const LAUNCHPAD_PROGRAM_ID = new PublicKey(
  "5TSpDPCpCCoykzWMTLqq3Go6QVEQvBiCr5RgjAeVRnVM",
);

export function getLaunchpadProgram(
  connection: Connection,
  wallet: AnchorWallet,
): Program<Idl> {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  return new Program(launchpadIdl as Idl, provider);
}

export function deriveLaunchpadPool(authority: PublicKey, saleMint: PublicKey, quoteMint: PublicKey) {
  const [pool] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), authority.toBuffer(), saleMint.toBuffer(), quoteMint.toBuffer()],
    LAUNCHPAD_PROGRAM_ID,
  );
  const [saleVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("sale_vault"), pool.toBuffer()],
    LAUNCHPAD_PROGRAM_ID,
  );
  const [quoteVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("quote_vault"), pool.toBuffer()],
    LAUNCHPAD_PROGRAM_ID,
  );
  return { pool, saleVault, quoteVault };
}

export function deriveContribution(pool: PublicKey, user: PublicKey) {
  const [contribution] = PublicKey.findProgramAddressSync(
    [Buffer.from("contribution"), pool.toBuffer(), user.toBuffer()],
    LAUNCHPAD_PROGRAM_ID,
  );
  return contribution;
}
