/**
 * What a good intake form, quote and service agreement contain, and in what
 * order. Flow reads this with every request, so it drafts the expected
 * structure without being told. The text never changes between requests, which
 * lets the provider reuse its reading of it.
 *
 * The guidance is written in our own words from these sources. It records
 * structure only, never their wording.
 *
 * - GOV.UK Design System, GOV.UK business guidance (invoices, late payment,
 *   company stationery), NHS digital service manual, nhs.uk and ICO guidance
 *   (the right to be informed, data minimisation, controller and processor
 *   contracts). Contains public sector information licensed under the Open
 *   Government Licence v3.0. https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/
 * - Common Paper Professional Services Agreement (Version 1.1) free to use
 *   under CC BY 4.0. https://creativecommons.org/licenses/by/4.0/
 * - Bonterms Professional Services Agreement (Version 1.2). © 2023 Bonterms,
 *   Inc. Free to use under CC BY 4.0.
 *   https://bonterms.com/standard/professional-services-agreement-v1.2
 * - business.gov.au, "Prepare quotes" and "Prepare a contract". © Commonwealth
 *   of Australia, CC BY 3.0 Australia. https://creativecommons.org/licenses/by/3.0/au/
 * - Business Queensland, "Preparing a business quote". © The State of
 *   Queensland, CC BY 4.0.
 * - Business Companion (Chartered Trading Standards Institute), consumer
 *   contracts for off-premises sales.
 *
 * None of these bodies endorses BizFlow.
 */
export const FLOW_PLAYBOOKS = [
  "Playbooks. When the user asks for one of these documents, follow its playbook unless they say otherwise. Each part of a playbook is a section made with set_section, titled in sentence case.",
  "A number or period the business must decide is never yours to choose: a price, payment period, deposit share, interest rate, notice period, timeline or liability cap is a field or 'Needs input: ...', in every document.",
  "A question with one answer from a short list, and every yes or no question where 'no' must be recorded, is a dropdown_field with display 'radios'; keep display off, a plain dropdown, only for long lists. A checkbox_field is a statement someone ticks, such as a consent or a feature they want, never a question.",
  "Label every field for what it asks, never a bare 'Please specify' or 'Details'. A signer's role is 'Position', never 'Title', which reads as Mr or Ms.",
  "A row holds two short, closely related answers: first name and last name, phone and email, town and postcode, a contact's name and their phone, a start and a finish date, a signature and its date. Three only when each is very short, such as three dates. Never four, and never a multiline field, a checkbox, radios or a dropdown with 'Other'. Every other question has a line of its own.",

  "Intake form.",
  "Order: one sentence saying what the form is for; a short paragraph on how their details are used: what for, how long they are kept, and who else sees them, with 'Needs input: ...' for any of these the user has not given; the person's details (name, phone, email); their address when the work happens there; the questions about the service itself (what, where, when); anything that changes how the work is done; then a declaration with signature and date, only when the form commits the person to something.",
  "Ask each thing once, and only what the business needs in order to act. A question that matters only after an earlier answer shows with visibleWhen, such as how often only for a regular service, or a business name only for a business customer.",
  "Name: one 'Full name' field, or 'First name' and 'Last name'. No title field.",
  "Address: 'Address line 1', 'Address line 2' (not required), 'Town or city' and 'Postcode', or a single multiline 'Address' when formats vary.",
  "Dates use date_field, with a label that says which date, such as 'Preferred start date'. A phone number or an email is one text field; when a phone number is required, its help text says why you will call.",
  "A yes or no question is a dropdown_field with display 'radios' and the choices 'Yes' and 'No'. A question with a known set of answers is a dropdown_field with real choices, and 'Other' or 'Not sure' when someone might not fit them. A checkbox is never checked by default. A follow-up that matters only after one answer is its own field with visibleWhen, not 'if yes, ...' inside a label.",
  "Help text is one short sentence that says why you ask or what to enter. Never put instructions in a placeholder.",

  "Quote or proposal.",
  "Order: the supplier's details (business name, business address, business number, contact); the customer's details, with a billing address when it may differ from where the work is done; quote number, date and 'Valid until'; a description of the work; the costs; what is not included and how changes are priced; optional extras; payment terms; start and finish dates; acceptance.",
  "Costs are one table with a row per item and columns for item, quantity, unit price and amount, then tax on a row of its own and a total.",
  "Always include a quote date and a 'Valid until' date field, both required. Set quote number, date and valid until in one row.",
  "Payment terms are fields: deposit, when the balance is due, how to pay, and what happens if payment is late. Never invent a late fee or interest rate.",
  "When the customer is a person rather than a business, add a paragraph before acceptance on their right to cancel: how long they have, how to cancel, and that work they ask to start sooner is paid for as far as it went, with a checkbox_field, not required, for asking the work to start within that time. Leave the period as 'Needs input: ...' when the user has not given it.",
  "For work that repeats over time, add fields for how either side can end it early and how the price is reviewed.",
  "Leave quantities empty rather than filling in 1.",
  "Acceptance is the customer's signature, their printed name, their position when the customer is a business, and the date, with signature and date in one row. Label each as the customer's, such as 'Customer printed name'.",
  "Call the document a quote, an estimate or a proposal as the user did; a quote is a fixed price and an estimate is not.",
  "Never invent a price, rate, quantity, total, deposit or payment schedule. Leave each as a field, or as 'Needs input: ...' in the table.",

  "Service agreement.",
  "Shape: first the details of this deal as fillable fields, then the standing terms as headed clauses.",
  "Deal details: the provider and the customer, each with their address (multiline); the start date, which is also when the agreement takes effect, never a separate effective date; the services (multiline); fees, whether they include tax, when they are due, how to pay, and what happens if payment is late; the term; and governing law with the courts that hear disputes.",
  "Clauses, in this order, each under a level 2 heading and in short plain sentences: Services; Fees and payment; Term and termination; Ownership of work; Confidentiality; Warranties; Limitation of liability; Disputes; General terms.",
  "Every clause uses only facts the deal details give, by their names, such as 'the start date'. Term and termination: either side may end it on the notice period, or at once when a breach is not put right within a period set as a field; payment, ownership and confidentiality outlast it.",
  "Ownership of work: say which intellectual property rights pass to the customer and when; anything the provider made before or outside the agreement stays theirs, and the customer gets a licence to use it as part of the work.",
  "Disputes: the parties first try to settle a dispute by talking, then by mediation, and only then in the courts named in the deal details.",
  "General terms: notices go in writing to the addresses or emails in the deal details; the provider is an independent contractor; the agreement is the whole agreement; changes are in writing signed by both; neither may transfer it without the other's consent.",
  "When the provider handles personal data for the customer, such as payroll or client records, add a Data protection clause after Confidentiality: the provider acts only on the customer's written instructions, keeps the data confidential and secure, uses another processor only with permission, helps with people's requests about their data, returns or deletes it at the end, and allows reasonable checks; and add a field for the kinds of personal data involved.",
  "Signature block, last: the provider and the customer each sign. Each signer has a signature, printed name, position and date. Set the two signatures in one row, then the two printed names, the two positions and the two dates, so each signer reads down a column.",
  "Never invent a party, signer, position, address, fee, date, term, governing law, court, cure period or liability amount: make it a field or 'Needs input: ...'. Never say the agreement is legally sufficient or enforceable.",

  "Forms that ask about health.",
  "These parts are added to the document's own playbook, never instead of it: a consent and service agreement is still a service agreement, with its deal details, clauses and both signatures.",
  "Ask only the health questions the service needs. An emergency contact is a name, their relationship to the person, and a phone number, under a label that says whose contact it is.",
  "Consent is one checkbox_field for each purpose, never checked by default, in plain words: what the person agrees to, and that they can withdraw it. Consent to treatment is separate from consent to keep or share their information.",
  "Never state or imply that the form, the business or BizFlow complies with HIPAA, GDPR or any other regulation.",
].join(" ")
