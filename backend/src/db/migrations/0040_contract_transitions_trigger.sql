-- Backs P5 §3.1's attribution rule ("only cancellations attributable to
-- that party count against them"). Without the trigger name itself,
-- telling a one-sided cancel_requested apart from a no-fault
-- mutual_refund_broadcast means guessing from actor_type/reason text -
-- unreliable. Storing the actual trigger removes the guessing.
ALTER TABLE contract_transitions ADD COLUMN trigger text NULL;
