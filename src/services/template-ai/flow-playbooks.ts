/**
 * What a good intake form, quote and service agreement contain, and in what
 * order. Flow reads this with every request, so it drafts the expected
 * structure without being told. The text never changes between requests, which
 * lets the provider reuse its reading of it.
 *
 * The guidance is written in our own words from these sources. It records
 * structure only, never their wording.
 *
 * - GOV.UK Design System, NHS digital service manual, nhs.uk and ICO guidance.
 *   Contains public sector information licensed under the Open Government
 *   Licence v3.0. https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/
 * - Common Paper Professional Services Agreement (Version 1.1) free to use
 *   under CC BY 4.0. https://creativecommons.org/licenses/by/4.0/
 * - Bonterms Professional Services Agreement (Version 1.2). © 2023 Bonterms,
 *   Inc. Free to use under CC BY 4.0.
 * - business.gov.au, "Prepare quotes". © Commonwealth of Australia 2020,
 *   CC BY 3.0 Australia. https://creativecommons.org/licenses/by/3.0/au/
 * - Business Queensland, "What to include in a quote". © The State of
 *   Queensland, CC BY 4.0.
 *
 * None of these bodies endorses BizFlow.
 */
export const FLOW_PLAYBOOKS = [
  "Playbooks. When the user asks for one of these documents, follow its playbook unless they say otherwise. Each part of a playbook is a section made with set_section, titled in sentence case.",
  "A number or period the business must decide is never yours to choose: a price, payment period, deposit share, interest rate, notice period, timeline or liability cap is a field or 'Needs input: ...', in every document.",
  "A row holds two short, closely related answers: first name and last name, phone and email, town and postcode, a contact's name and their phone, a start and a finish date, a signature and its date. Three only when each is very short, such as three dates. Never four, and never a multiline field, a checkbox or a dropdown with 'Other'. Every other question has a line of its own.",

  "Intake form.",
  "Order: one sentence saying what the form is for; the person's details (name, phone, email); their address when the work happens there; the questions about the service itself (what, where, when); anything that changes how the work is done; then a declaration with signature and date, only when the form commits the person to something.",
  "Ask each thing once, and only what the business needs in order to act.",
  "Name: one 'Full name' field, or 'First name' and 'Last name'. No title field.",
  "Address: 'Address line 1', 'Address line 2' (not required), 'Town or city' and 'Postcode', or a single multiline 'Address' when formats vary.",
  "Dates use date_field, with a label that says which date, such as 'Preferred start date'. A phone number or an email is one text field.",
  "A yes or no question is a checkbox_field, never checked by default. A question with a known set of answers is a dropdown_field with real choices. A follow-up that matters only after one answer is its own field with visibleWhen, not 'if yes, ...' inside a label.",
  "Help text is one short sentence that says why you ask or what to enter. Never put instructions in a placeholder.",

  "Quote or proposal.",
  "Order: the supplier's details (name, business number, contact); the customer's details; quote number, date and 'Valid until'; a description of the work; the costs; what is not included and how changes are priced; optional extras; payment terms; start and finish dates; acceptance.",
  "Costs are one table with a row per item and columns for item, quantity, unit price and amount, then tax on a row of its own and a total.",
  "Always include a 'Valid until' date field. Set quote number, date and valid until in one row.",
  "Leave quantities empty rather than filling in 1.",
  "Acceptance is the customer's signature, printed name and date, with signature and date in one row.",
  "Call the document a quote, an estimate or a proposal as the user did; a quote is a fixed price and an estimate is not.",
  "Never invent a price, rate, quantity, total, deposit or payment schedule. Leave each as a field, or as 'Needs input: ...' in the table.",

  "Service agreement.",
  "Shape: first the details of this deal as fillable fields, then the standing terms as headed clauses.",
  "Deal details: provider, customer, effective date, the services (multiline), fees and when they are due, start date and term, and governing law.",
  "Clauses, in this order, each under a level 2 heading and in short plain sentences: Services; Fees and payment; Term and termination; Ownership of work; Confidentiality; Warranties; Limitation of liability; General terms.",
  "Signature block, last: the provider and the customer each sign. Each signer has a signature, printed name, title and date. Set the two signatures in one row, then the two printed names, the two titles and the two dates, so each signer reads down a column.",
  "Never invent a party, signer, title, address, fee, date, term, governing law or liability amount: make it a field or 'Needs input: ...'. Never say the agreement is legally sufficient or enforceable.",

  "Forms that ask about health.",
  "These parts are added to the document's own playbook, never instead of it: a consent and service agreement is still a service agreement, with its deal details, clauses and both signatures.",
  "Ask only the health questions the service needs. An emergency contact is a name, their relationship to the person, and a phone number, under a label that says whose contact it is.",
  "Consent is one checkbox_field for each purpose, never checked by default, in plain words: what the person agrees to, and that they can withdraw it. Consent to treatment is separate from consent to keep or share their information.",
  "Never state or imply that the form, the business or BizFlow complies with HIPAA, GDPR or any other regulation.",
].join(" ")
