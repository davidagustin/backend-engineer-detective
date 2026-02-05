import type { DetectiveCase } from "../../types";

export const openapiSchemaDrift: DetectiveCase = {
	id: "openapi-schema-drift",
	title: "The OpenAPI Schema Drift",
	subtitle: "400 errors due to schema mismatch between services",
	difficulty: "junior",
	category: "networking",

	crisis: {
		description:
			"The mobile app team's requests to the API are returning 400 Bad Request errors after a backend update. The web frontend works fine. The mobile team insists their requests match the API documentation, but the server keeps rejecting them.",
		impact:
			"Mobile app completely broken for 24 hours. 40% of users are mobile-only. App store reviews dropping. Backend and mobile teams blaming each other.",
		timeline: [
			{ time: "Tuesday 2:00 PM", event: "Backend team deploys 'minor' API update", type: "normal" },
			{ time: "Tuesday 3:00 PM", event: "Mobile app users start reporting errors", type: "warning" },
			{ time: "Tuesday 4:00 PM", event: "Mobile team confirms app code unchanged", type: "warning" },
			{ time: "Tuesday 5:00 PM", event: "Web frontend working, mobile broken", type: "critical" },
			{ time: "Wednesday 10:00 AM", event: "Still debugging - API docs say one thing, server expects another", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Web frontend works (uses generated TypeScript client)",
			"Postman requests using saved examples work",
			"API documentation looks correct",
			"Backend unit tests pass",
		],
		broken: [
			"Mobile app gets 400 Bad Request",
			"Error: 'additionalProperty \"user_id\" not allowed'",
			"Mobile requests match the published API docs",
			"New requests using current docs fail",
		],
	},

	clues: [
		{
			id: 1,
			title: "The 400 Error Response",
			type: "logs",
			content: `\`\`\`json
{
  "error": "Bad Request",
  "message": "Request validation failed",
  "details": [
    {
      "path": "/body/user_id",
      "message": "additionalProperty 'user_id' is not allowed"
    },
    {
      "path": "/body/amount",
      "message": "must be integer, got number"
    }
  ]
}
\`\`\``,
			hint: "The server expects different field names and types than documented...",
		},
		{
			id: 2,
			title: "Published API Documentation (docs.api.com)",
			type: "config",
			content: `\`\`\`yaml
# OpenAPI spec at docs.api.com/openapi.yaml
# Last updated: Monday (before deployment)

paths:
  /api/orders:
    post:
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - user_id
                - amount
                - items
              properties:
                user_id:
                  type: string
                  description: User's ID
                amount:
                  type: number
                  description: Order total
                items:
                  type: array
                  items:
                    type: object
\`\`\``,
		},
		{
			id: 3,
			title: "Actual Server Validation Schema",
			type: "code",
			content: `\`\`\`typescript
// backend/src/routes/orders.ts
// Updated Tuesday 2:00 PM

const createOrderSchema = z.object({
  // Renamed from user_id to userId (camelCase standardization)
  userId: z.string(),
  // Changed from number to integer (cents, not dollars)
  amount: z.number().int(),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number().int(),
  })),
}).strict(); // strict() rejects additional properties!

app.post('/api/orders', (req, res) => {
  const result = createOrderSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Request validation failed',
      details: result.error.issues,
    });
  }
  // ...
});
\`\`\``,
			hint: "user_id became userId, amount became integer, schema is strict",
		},
		{
			id: 4,
			title: "Why Web Frontend Works",
			type: "code",
			content: `\`\`\`typescript
// web-frontend/src/api/client.ts
// Auto-generated from OpenAPI spec!

// This file was regenerated Tuesday 2:30 PM
// by the CI pipeline that updates when backend deploys

export interface CreateOrderRequest {
  userId: string;  // Updated automatically!
  amount: number;  // TypeScript number, but backend converts
  items: OrderItem[];
}

export async function createOrder(request: CreateOrderRequest) {
  // Uses the generated types, which match the server
  return fetch('/api/orders', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

// Web team never manually updates API types
// They always use the auto-generated client
\`\`\``,
		},
		{
			id: 5,
			title: "Mobile Team's API Client",
			type: "code",
			content: `\`\`\`swift
// iOS App - OrderService.swift
// Manually maintained based on API documentation

struct CreateOrderRequest: Codable {
    let user_id: String  // Still using old snake_case!
    let amount: Double   // Still using Double (float)!
    let items: [OrderItem]
}

func createOrder(_ request: CreateOrderRequest) async throws -> Order {
    let data = try JSONEncoder().encode(request)

    // Request body: {"user_id": "123", "amount": 29.99, ...}
    // Server expects: {"userId": "123", "amount": 2999, ...}

    let response = try await URLSession.shared.data(for: urlRequest)
    // Gets 400 Bad Request
}
\`\`\``,
			hint: "Mobile uses manually maintained types based on outdated docs",
		},
		{
			id: 6,
			title: "Version Control History",
			type: "logs",
			content: `\`\`\`
Git log for backend repository:

commit a1b2c3d (Tuesday 2:00 PM)
Author: Backend Dev
Message: Standardize API to camelCase, amounts in cents

  - Renamed all snake_case fields to camelCase
  - Changed monetary amounts from float dollars to integer cents
  - Added strict schema validation
  - Updated internal OpenAPI spec

commit d4e5f6g (Tuesday 2:05 PM)
Author: CI Bot
Message: Auto-update TypeScript client from OpenAPI spec

Note: The openapi.yaml on docs.api.com is deployed separately
      and wasn't updated! It's managed by the DevOps team
      and requires a manual deployment process.
\`\`\``,
		},
	],

	solution: {
		diagnosis: "API schema changed without updating public documentation, causing clients using the outdated docs to send invalid requests",
		keywords: [
			"openapi",
			"schema drift",
			"api documentation",
			"400 bad request",
			"validation",
			"contract",
			"breaking change",
			"snake_case",
			"camelCase",
		],
		rootCause: `The root cause is schema drift between the actual API implementation and the published documentation.

The sequence of problems:
1. Backend team changed field names (user_id -> userId) and types (float -> int)
2. Backend's internal OpenAPI spec was updated
3. Web frontend auto-generates client from this spec, so it stayed in sync
4. Public API docs (docs.api.com) are deployed separately and weren't updated
5. Mobile team uses manual types based on public docs - now outdated

This is a common pattern in API evolution:
- Breaking changes without versioning
- Documentation as afterthought, not source of truth
- Different update processes for code vs docs
- Some clients auto-generate (stay in sync) vs manual (drift)

The backend's .strict() validation (rejecting unknown fields) turned what could have been a silent data loss into an explicit error - which is actually better for debugging.`,
		codeExamples: [
			{
				lang: "yaml",
				description: "API versioning to prevent breaking changes",
				code: `# openapi.yaml - with versioning
openapi: 3.0.0
info:
  title: Orders API
  version: 2.0.0  # Bump major version for breaking changes

servers:
  - url: /api/v2  # Version in URL path

paths:
  /orders:  # Full path: /api/v2/orders
    post:
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateOrderRequest'

# Keep v1 running for backward compatibility
# /api/v1/orders still accepts user_id and float amounts`,
			},
			{
				lang: "typescript",
				description: "Contract-first development with schema validation",
				code: `// Use OpenAPI spec as source of truth
// Generate BOTH server validation AND client types from it

// 1. Define API in openapi.yaml (single source of truth)
// 2. Generate Zod schema for server validation
import { schemas } from './generated/schemas';

app.post('/api/v2/orders', (req, res) => {
  const result = schemas.CreateOrderRequest.safeParse(req.body);
  // Validation schema generated from OpenAPI, guaranteed to match docs
});

// 3. Generate client types for web/mobile
// Run: npx openapi-typescript openapi.yaml -o ./generated/api.ts

// 4. CI pipeline ensures everything regenerates on spec change`,
			},
			{
				lang: "yaml",
				description: "CI pipeline for schema synchronization",
				code: `# .github/workflows/api-sync.yml
name: API Schema Sync

on:
  push:
    paths:
      - 'openapi.yaml'
      - 'src/routes/**'

jobs:
  validate-sync:
    runs-on: ubuntu-latest
    steps:
      - name: Check schema matches implementation
        run: |
          # Generate schema from code
          npm run generate:openapi

          # Compare with committed schema
          diff openapi.yaml generated-openapi.yaml

          # Fail if they differ
          if [ $? -ne 0 ]; then
            echo "ERROR: OpenAPI spec out of sync with implementation!"
            echo "Either update the spec or revert the code change."
            exit 1
          fi

  deploy-docs:
    needs: validate-sync
    runs-on: ubuntu-latest
    steps:
      - name: Deploy updated docs
        run: |
          # Automatically deploy to docs.api.com
          npm run deploy:docs`,
			},
			{
				lang: "typescript",
				description: "Backward compatible field handling",
				code: `// Support both old and new field names during migration
const createOrderSchema = z.object({
  // Accept both userId and user_id (legacy)
  userId: z.string().optional(),
  user_id: z.string().optional(),  // Deprecated but still accepted

  // Accept both integer cents and float dollars
  amount: z.union([
    z.number().int(),  // New: cents
    z.number().transform(dollars => Math.round(dollars * 100)),  // Old: convert
  ]),

  items: z.array(orderItemSchema),
}).transform(data => ({
  // Normalize to new format internally
  userId: data.userId || data.user_id,
  amount: data.amount,
  items: data.items,
})).refine(data => data.userId, {
  message: "Either userId or user_id is required",
});`,
			},
		],
		prevention: [
			"Use contract-first development - OpenAPI spec is source of truth",
			"Auto-generate server validation and client types from the same spec",
			"CI pipeline should fail if implementation diverges from spec",
			"Version your APIs - breaking changes require new major version",
			"Deploy documentation atomically with code changes",
			"Add deprecation periods for field changes",
			"Use schema validation that shows clear error messages",
			"Document breaking changes in changelog",
		],
		educationalInsights: [
			"Schema drift is when docs and implementation diverge silently",
			"Contract-first: design API spec, then implement to match",
			"Code-first: implement API, then generate docs (prone to drift)",
			"Auto-generated clients stay in sync; manual clients drift",
			"Strict validation (reject unknown fields) helps catch drift early",
			"API versioning allows breaking changes without breaking clients",
		],
	},
};
