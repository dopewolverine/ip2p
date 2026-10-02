-- The `n` in every per-contract derivation path (§4.1 step 1: "Allocate
-- contract_index n (monotonic, never reused)"). A sequence guarantees
-- exactly that, independent of any application-level locking.
CREATE SEQUENCE contract_index_seq START 1;
