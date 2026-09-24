import {
  createInternalSubmissionDraft as defaultCreateInternalSubmissionDraft,
  submitInternalSubmission as defaultSubmitInternalSubmission,
} from "@/services/submission-service"
import type { TemplateServiceDeps } from "@/services/templates/contracts"
import { TemplateServiceError } from "@/services/templates/errors"
import {
  createDatabaseError,
  createId,
  getClient,
  nowIso,
  requirePermission,
  runTemplateOperation,
} from "@/services/templates/shared"
import { templateContentV3Schema, type TemplateContentV3 } from "@/types/template"

/** One worked example submitted against a starter template. */
export type StarterSampleSubmission = {
  title: string
  values: Record<string, unknown>
}

export type StarterTemplateDefinition = {
  title: string
  description: string
  category: "Safety" | "Operations" | "Admin" | "Finance"
  content: TemplateContentV3
  /**
   * Worked examples seeded on request, so a pilot can see a populated list,
   * review queue and export before anyone fills a form by hand. Keys must match
   * the template's `fieldKey`s — the real submission validator runs over them.
   */
  sampleSubmissions: StarterSampleSubmission[]
}

export const STARTER_TEMPLATES: StarterTemplateDefinition[] = [
  {
    title: "Incident & Safety Report",
    description: "Standard report form for documenting workplace incidents, hazards, and corrective actions.",
    category: "Safety",
    content: templateContentV3Schema.parse({
      schemaVersion: 3,
      branding: {
        organizationName: "BizFlow",
        logoDataUrl: null,
        logoAlignment: "left",
        logoWidthPercent: 30,
        primaryColor: "#0f172a",
        accentColor: "#0284c7",
      },
      blocks: [
        {
          id: "10000000-0000-4000-8000-000000000001",
          type: "heading",
          text: "Incident Information",
          level: 2,
          alignment: "left",
        },
        {
          id: "10000000-0000-4000-8000-000000000002",
          type: "date_field",
          fieldKey: "incident_date",
          label: "Date of Incident",
          required: true,
          helpText: "Select the date when the incident occurred.",
        },
        {
          id: "10000000-0000-4000-8000-000000000003",
          type: "text_field",
          fieldKey: "incident_location",
          label: "Location / Department",
          required: true,
          multiline: false,
          placeholder: "e.g., Warehouse Bay 4",
          helpText: null,
        },
        {
          id: "10000000-0000-4000-8000-000000000004",
          type: "dropdown_field",
          fieldKey: "severity_level",
          label: "Severity Level",
          required: true,
          options: ["Low (Near Miss)", "Medium (Minor Injury/Damage)", "High (Severe Incident)"],
          placeholder: "Select severity...",
          helpText: null,
        },
        {
          id: "10000000-0000-4000-8000-000000000005",
          type: "text_field",
          fieldKey: "incident_description",
          label: "Incident Description",
          required: true,
          multiline: true,
          placeholder: "Describe exactly what happened...",
          helpText: null,
        },
      ],
      sections: [],
      fieldGroups: [],
      blockRules: [],
    }),
    sampleSubmissions: [
      {
        title: "Sample: forklift near miss in Bay 4",
        values: {
          incident_date: "2026-07-14",
          incident_location: "Warehouse Bay 4",
          severity_level: "Low (Near Miss)",
          incident_description:
            "A forklift reversed toward a pedestrian walkway while the spotter was away. No contact and no injury. Walkway markings have been repainted and the spotter rota reissued.",
        },
      },
      {
        title: "Sample: chemical spill in the wash bay",
        values: {
          incident_date: "2026-07-22",
          incident_location: "Wash Bay",
          severity_level: "Medium (Minor Injury/Damage)",
          incident_description:
            "A 5L degreaser container split while being moved. One operator reported skin irritation and was treated on site. Spill kit used; supplier has been asked about container batch quality.",
        },
      },
    ],
  },
  {
    title: "Equipment & Facility Inspection",
    description: "Routine maintenance and safety check sheet for machinery and physical facilities.",
    category: "Operations",
    content: templateContentV3Schema.parse({
      schemaVersion: 3,
      branding: {
        organizationName: "BizFlow",
        logoDataUrl: null,
        logoAlignment: "left",
        logoWidthPercent: 30,
        primaryColor: "#0f172a",
        accentColor: "#16a34a",
      },
      blocks: [
        {
          id: "20000000-0000-4000-8000-000000000001",
          type: "heading",
          text: "Facility Checklist",
          level: 2,
          alignment: "left",
        },
        {
          id: "20000000-0000-4000-8000-000000000002",
          type: "text_field",
          fieldKey: "equipment_name",
          label: "Equipment Serial / Tag #",
          required: true,
          multiline: false,
          placeholder: "e.g., GEN-9021",
          helpText: null,
        },
        {
          id: "20000000-0000-4000-8000-000000000003",
          type: "checkbox_field",
          fieldKey: "inspection_passed",
          label: "All safety guards operational and clean",
          required: false,
          checkedByDefault: true,
          helpText: null,
        },
        {
          id: "20000000-0000-4000-8000-000000000004",
          type: "text_field",
          fieldKey: "inspector_notes",
          label: "Inspector Notes",
          required: false,
          multiline: true,
          placeholder: "Add any maintenance recommendations...",
          helpText: null,
        },
      ],
      sections: [],
      fieldGroups: [],
      blockRules: [],
    }),
    sampleSubmissions: [
      {
        title: "Sample: compressor 2 monthly check",
        values: {
          equipment_name: "Air compressor 2",
          inspection_passed: true,
          inspector_notes:
            "Pressure holding at 8 bar, no audible leaks, belt tension within tolerance. Next service due in September.",
        },
      },
      {
        title: "Sample: loading dock shutter check",
        values: {
          equipment_name: "Loading dock shutter",
          inspection_passed: false,
          inspector_notes:
            "Shutter binds about two thirds of the way down and the safety edge did not trigger on test. Taken out of service pending an engineer visit.",
        },
      },
    ],
  },
  {
    title: "Expense & Purchase Request",
    description: "Formal approval form for business expenses, software subscriptions, or supply orders.",
    category: "Finance",
    content: templateContentV3Schema.parse({
      schemaVersion: 3,
      branding: {
        organizationName: "BizFlow",
        logoDataUrl: null,
        logoAlignment: "left",
        logoWidthPercent: 30,
        primaryColor: "#0f172a",
        accentColor: "#9333ea",
      },
      blocks: [
        {
          id: "30000000-0000-4000-8000-000000000001",
          type: "heading",
          text: "Purchase Request Details",
          level: 2,
          alignment: "left",
        },
        {
          id: "30000000-0000-4000-8000-000000000002",
          type: "text_field",
          fieldKey: "item_title",
          label: "Item or Service Name",
          required: true,
          multiline: false,
          placeholder: "e.g., Office Ergonomic Chairs",
          helpText: null,
        },
        {
          id: "30000000-0000-4000-8000-000000000003",
          type: "text_field",
          fieldKey: "estimated_amount",
          label: "Total Estimated Cost ($)",
          required: true,
          multiline: false,
          placeholder: "e.g., 450.00",
          helpText: null,
        },
      ],
      sections: [],
      fieldGroups: [],
      blockRules: [],
    }),
    sampleSubmissions: [
      {
        title: "Sample: replacement safety boots",
        values: {
          item_title: "Replacement safety boots (4 pairs)",
          estimated_amount: "320.00",
        },
      },
    ],
  },
]

/** Outcome of one starter-template seeding pass. */
export type SeedStarterTemplatesResult = {
  seededCount: number
  skippedCount: number
}

/**
 * Seeds the starter template library into an organization, skipping duplicates.
 *
 * Seeding writes published templates on the actor's behalf, so it is gated on
 * the same `templates:manage` permission as authoring one by hand — otherwise
 * any staff member could publish into the workspace.
 *
 * Re-running is safe: a starter whose title already exists in the tenant is
 * counted as skipped rather than duplicated.
 *
 * @param input - Actor and tenant identifiers.
 * @param deps - Optional database, identifier, and clock dependencies.
 * @returns How many starters were created and how many already existed.
 * @throws TemplateServiceError when access or persistence fails.
 */
export async function seedStarterTemplatesForOrganization(
  input: { actorUserId: string; organizationId: string },
  deps: TemplateServiceDeps = {}
): Promise<SeedStarterTemplatesResult> {
  return runTemplateOperation(
    "seed_starter_templates",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
    },
    async (): Promise<SeedStarterTemplatesResult> => {
      const client = getClient(deps)
      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "templates:manage",
        "You cannot add starter templates."
      )

      const timestamp = nowIso(deps)
      let seededCount = 0
      let skippedCount = 0

      for (const starter of STARTER_TEMPLATES) {
        const { data: existing, error: lookupError } = await client
          .from("document_templates")
          .select("id")
          .eq("org_id", input.organizationId)
          .eq("title", starter.title)
          .maybeSingle()

        if (lookupError) {
          throw createDatabaseError(
            lookupError,
            "Unable to check the existing template library."
          )
        }

        if (existing) {
          skippedCount += 1
          continue
        }

        const { error: insertError } = await client
          .from("document_templates")
          .insert({
            id: createId(deps),
            org_id: input.organizationId,
            title: starter.title,
            description: starter.description,
            category: starter.category,
            status: "published",
            revision: 1,
            content: starter.content as never,
            created_by: input.actorUserId,
            updated_by: input.actorUserId,
            published_by: input.actorUserId,
            archived_by: null,
            created_at: timestamp,
            updated_at: timestamp,
            published_at: timestamp,
            archived_at: null,
          } as never)

        if (insertError) {
          throw createDatabaseError(
            insertError,
            `Unable to add the "${starter.title}" starter template.`
          )
        }

        seededCount += 1
      }

      if (seededCount === 0 && skippedCount === 0) {
        throw new TemplateServiceError(
          "No starter templates are available to add.",
          500
        )
      }

      return { seededCount, skippedCount }
    }
  )
}

/** How many worked examples a full sample-data seed writes. */
export const SAMPLE_SUBMISSION_COUNT = STARTER_TEMPLATES.reduce(
  (total: number, starter: StarterTemplateDefinition): number =>
    total + starter.sampleSubmissions.length,
  0
)

/** Outcome of one sample-submission seeding pass. */
export type SeedSampleSubmissionsResult = {
  seededCount: number
  skippedCount: number
}

/** Dependencies the sample seeder injects for tests. */
export type SeedSampleSubmissionsDeps = TemplateServiceDeps & {
  createInternalSubmissionDraft?: typeof defaultCreateInternalSubmissionDraft
  submitInternalSubmission?: typeof defaultSubmitInternalSubmission
}

/**
 * Seeds worked example submissions against the seeded starter templates.
 *
 * Sprint 13 promised sample data and shipped none, so a fresh pilot workspace
 * showed an empty submissions list, an empty review queue and an empty export
 * until someone filled a form by hand.
 *
 * Gated on `templates:manage`, matching `seedStarterTemplatesForOrganization` —
 * this writes submitted records into a shared workspace, which is not something
 * a staff member should be able to do in bulk. The composed submission
 * operations enforce `submissions:create` on top of that.
 *
 * The examples go through the real draft-and-submit path rather than raw
 * inserts, so they carry a genuine template snapshot and pass the same
 * validator as a member's own submission. A starter template that has not been
 * seeded yet is skipped rather than treated as an error.
 *
 * Re-running is safe: a sample whose title already exists in the tenant counts
 * as skipped.
 *
 * @param input - Actor and tenant identifiers.
 * @param deps - Optional database, identifier, clock, and submission dependencies.
 * @returns How many samples were created and how many already existed.
 * @throws TemplateServiceError when access or persistence fails.
 */
export async function seedSampleSubmissionsForOrganization(
  input: { actorUserId: string; organizationId: string },
  deps: SeedSampleSubmissionsDeps = {}
): Promise<SeedSampleSubmissionsResult> {
  return runTemplateOperation(
    "seed_sample_submissions",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
    },
    async (): Promise<SeedSampleSubmissionsResult> => {
      const client = getClient(deps)
      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "templates:manage",
        "You cannot add sample submissions."
      )

      const createDraft =
        deps.createInternalSubmissionDraft ?? defaultCreateInternalSubmissionDraft
      const submitDraft =
        deps.submitInternalSubmission ?? defaultSubmitInternalSubmission

      let seededCount = 0
      let skippedCount = 0

      for (const starter of STARTER_TEMPLATES) {
        const { data: template, error: templateError } = await client
          .from("document_templates")
          .select("id")
          .eq("org_id", input.organizationId)
          .eq("title", starter.title)
          .eq("status", "published")
          .maybeSingle()

        if (templateError) {
          throw createDatabaseError(
            templateError,
            "Unable to check the existing template library."
          )
        }

        if (!template) {
          // Its starter template has not been seeded, so there is nothing to
          // submit against. Counted as skipped, not as a failure.
          skippedCount += starter.sampleSubmissions.length
          continue
        }

        for (const sample of starter.sampleSubmissions) {
          const { data: existing, error: lookupError } = await client
            .from("submissions")
            .select("id")
            .eq("org_id", input.organizationId)
            .eq("title", sample.title)
            .maybeSingle()

          if (lookupError) {
            throw createDatabaseError(
              lookupError,
              "Unable to check the existing submissions."
            )
          }

          if (existing) {
            skippedCount += 1
            continue
          }

          const submissionId = createId(deps)
          const draft = await createDraft({
            actorUserId: input.actorUserId,
            organizationId: input.organizationId,
            submissionId,
            templateId: (template as { id: string }).id,
            title: sample.title,
          })

          await submitDraft({
            actorUserId: input.actorUserId,
            organizationId: input.organizationId,
            submissionId: draft.id,
            expectedRevision: draft.revision,
            values: sample.values,
          })

          seededCount += 1
        }
      }

      if (seededCount === 0 && skippedCount === 0) {
        throw new TemplateServiceError(
          "No sample submissions are available to add.",
          500
        )
      }

      return { seededCount, skippedCount }
    }
  )
}
