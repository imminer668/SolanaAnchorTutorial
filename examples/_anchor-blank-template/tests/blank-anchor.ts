import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BlankAnchor } from "../target/types/blank_anchor";

describe("blank_anchor", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.blankAnchor as Program<BlankAnchor>;

  it("pings", async () => {
    await program.methods.ping().rpc();
  });
});
