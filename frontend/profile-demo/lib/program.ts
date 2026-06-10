import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import profileIdl from "./idl/profile.json";

export const PROFILE_PROGRAM_ID = new PublicKey(
  "B9LbcgwyuVSM2dMvhN4Mu1d6zLoUncwHpVLzwVNDCMsy",
);

export const PROFILE_SEED = "profile";

export function deriveProfilePda(user: PublicKey): {
  pda: PublicKey;
  bump: number;
} {
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from(PROFILE_SEED), user.toBuffer()],
    PROFILE_PROGRAM_ID,
  );
  return { pda, bump };
}

export function getProfileProgram(
  connection: Connection,
  wallet: AnchorWallet,
): Program<Idl> {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  return new Program(profileIdl as Idl, provider);
}
