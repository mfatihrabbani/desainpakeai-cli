import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readJsonResponse } from "./auth-client.js";
import { resolveCredential, type CredentialOverrides } from "./credentials.js";

export type ReviewClientOptions = CredentialOverrides;

export type GetReviewInput = {
  output?: string;
  reviewId: string;
};

export async function getReview(
  input: GetReviewInput,
  options: ReviewClientOptions,
) {
  const credential = await resolveCredential(options);
  const base = credential.apiUrl.replace(/\/$/, "");
  const reviewId = encodeURIComponent(input.reviewId);
  const headers = { Authorization: `Bearer ${credential.apiKey}` };
  const metadataResponse = await fetch(`${base}/api/cli/reviews/${reviewId}`, { headers });
  const review = await readJsonResponse(metadataResponse);

  const imageResponse = await fetch(`${base}/api/cli/reviews/${reviewId}/image`, { headers });
  if (!imageResponse.ok) await readJsonResponse(imageResponse);
  const outputPath = resolve(input.output ?? `.output/reviews/${input.reviewId}.png`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, new Uint8Array(await imageResponse.arrayBuffer()));

  return {
    ...(typeof review === "object" && review !== null ? review : {}),
    imagePath: outputPath,
  };
}
