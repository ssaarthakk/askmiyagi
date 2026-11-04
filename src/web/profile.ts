import { parseContract } from "../shared/parse.ts";
import {
  defaultProfile,
  frequencies,
  levels,
  modes,
  type Profile,
  profileSchema,
} from "../shared/profile.ts";
import type { Result } from "../shared/result.ts";
import { responseError } from "./response-error.ts";

type ProfileKey = keyof Profile;
export type ProfileQuestion = {
  key: ProfileKey;
  text: string;
  choices: { value: string; label: string }[];
};

function choices(values: readonly string[]) {
  return values.map((value) => ({ value, label: value[0]?.toUpperCase() + value.slice(1) }));
}

export const profileQuestions: ProfileQuestion[] = [
  { key: "level", text: "How much experience do you have with code?", choices: choices(levels) },
  { key: "mode", text: "Should I teach you as we go, or just answer?", choices: choices(modes) },
  {
    key: "frequency",
    text: "How often should I ask you questions to check you understood?",
    choices: choices(frequencies),
  },
  { key: "goal", text: "What do you want to do with this repo?", choices: [] },
];

export function answerProfile(
  profile: Profile,
  key: ProfileKey,
  value: string | null,
): Result<Profile> {
  return parseContract(profileSchema, { ...profile, [key]: value ?? defaultProfile[key] });
}

export async function fetchProfile(token: string) {
  const response = await fetch("/api/profile", { headers: { "x-miyagi-token": token } });
  if (!response.ok) throw await responseError(response, "Loading the profile");
  return profileSchema.nullable().parse(await response.json());
}

export async function saveProfile(profile: Profile, token: string) {
  const response = await fetch("/api/profile", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-miyagi-token": token },
    body: JSON.stringify(profile),
  });
  if (!response.ok) throw await responseError(response, "Saving the profile");
  return profileSchema.parse(await response.json());
}
