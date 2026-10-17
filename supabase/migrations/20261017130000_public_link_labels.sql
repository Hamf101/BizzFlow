-- A link for anyone can be named for where it is used ("Front desk",
-- "Website"), so whoever manages it can tell its links apart.
alter table public.public_form_links
  add column label text,
  add constraint public_form_links_label_length
    check (label is null or (label = btrim(label) and char_length(label) between 1 and 80));
