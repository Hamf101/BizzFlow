-- The place in its send of the person a link went to: the k-th person listed
-- signs Signer k's boxes (Signer 1's when the document has none for them).
-- Null on a link for anyone and on links sent before this, which answer as
-- Signer 1. Additive, so reading code tolerates it either way.
alter table public.public_form_links
  add column signer smallint check (signer between 1 and 20);
