import mongoose from "mongoose";
import pLimit from "p-limit";
import * as webpush from "web-push";
import { isCanvasAssignmentSubmitted } from "common/canvas";
import { isMongoDuplicateKeyError } from "../utils/canvasUserSync.js";
import {
  BROWSER_PUSH_SENT_IDS_MAX,
  createDefaultBrowserPushPreferences,
  normalizeBrowserPushPreferences,
  normalizeBrowserPushSentState,
  type BrowserPushPreferences,
  type WebPushSubscription,
} from "common/notifications";
import { User } from "../database/models/User.js";
import { WebPushSubscriptionModel } from "../database/models/WebPushSubscription.js";
import {
  fetchAllAnnouncements,
  fetchAssignments,
  fetchCourses,
  fetchUpcomingEvents,
} from "../rutere/canvas/canvasService.js";
import { decrypt } from "../utils/kryptering.js";
import { logger } from "../utils/logger.js";
import { stripHtml } from "../utils/htmlUtils.js";

const webPushClient = (
  "default" in webpush &&
  webpush.default &&
  typeof webpush.default === "object"
    ? webpush.default
    : webpush
) as typeof webpush;

export const WEB_PUSH_POLL_INTERVAL_MS = 10 * 60 * 1000;
const WEB_PUSH_USER_BATCH_LIMIT = 50;
const WEB_PUSH_NOTIFICATION_LIMIT = 3;
const ANNOUNCEMENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEADLINE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Tidlig varsel-vindu: 3-5 dager før frist (for komplekse oppgaver). */
const EARLY_DEADLINE_MIN_MS = 3 * 24 * 60 * 60 * 1000;
const EARLY_DEADLINE_MAX_MS = 5 * 24 * 60 * 60 * 1000;
/** Poenggrenser for kompleksitetsvurdering. */
const POINTS_THRESHOLD_HIGH = 70;
const POINTS_THRESHOLD_MEDIUM = 30;
const EVENT_WINDOW_MS = 2 * 60 * 60 * 1000;
export const AI_COMPLETION_PUSH_MIN_DURATION_MS = 15 * 1000;
const NOTIFICATIONS_DASHBOARD_URL = "/dashboard?view=varslinger";
let webPushBatchRunning = false;

export class WebPushSubscriptionConflictError extends Error {
  constructor() {
    super("Web-push-abonnementet er allerede registrert for en annen bruker.");
    this.name = "WebPushSubscriptionConflictError";
  }
}

type PushCandidate = {
  id: string;
  title: string;
  body: string;
  url: string;
  tag: string;
  createdAt: number;
};

function getWebPushConfig() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject =
    process.env.WEB_PUSH_SUBJECT?.trim() || "mailto:kontakt@studwize.page";

  return {
    configured: Boolean(publicKey && privateKey),
    publicKey: publicKey ?? "",
    privateKey: privateKey ?? "",
    subject,
  };
}

let vapidConfigured = false;

function ensureWebPushConfigured(): boolean {
  const config = getWebPushConfig();
  if (!config.configured) {
    return false;
  }

  if (!vapidConfigured) {
    webPushClient.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    vapidConfigured = true;
  }

  return true;
}

function isGoneSubscriptionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const statusCode =
    "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : null;

  return statusCode === 404 || statusCode === 410;
}

function truncateText(value: string, maxLength = 140): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

async function sendPayloadToSubscriptions(
  subscriptions: Array<{
    _id: mongoose.Types.ObjectId;
    endpoint: string;
    expirationTime?: number | null;
    keys: { p256dh: string; auth: string };
  }>,
  payload: PushCandidate,
): Promise<boolean> {
  let delivered = false;

  for (const subscription of subscriptions) {
    const pushSubscription: webpush.PushSubscription = {
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime ?? null,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    };

    try {
      await webPushClient.sendNotification(
        pushSubscription,
        JSON.stringify({
          title: payload.title,
          body: payload.body,
          url: payload.url,
          tag: payload.tag,
          icon: "/icons/icon-192x192.png",
          badge: "/icons/icon-192x192.png",
        }),
      );
      delivered = true;
    } catch (error) {
      if (isGoneSubscriptionError(error)) {
        await WebPushSubscriptionModel.deleteOne({ _id: subscription._id });
        logger.info(
          { endpoint: subscription.endpoint },
          "Slettet ugyldig web-push-abonnement",
        );
        continue;
      }

      logger.warn(
        { err: error, endpoint: subscription.endpoint },
        "Utsending av web-push feilet",
      );
    }
  }

  return delivered;
}

function buildAnnouncementCandidates(
  announcements: Array<{
    id: number;
    title: string;
    message?: string | null;
    context_code?: string;
    posted_at?: string | null;
  }>,
  courseMap: Map<string, string>,
): PushCandidate[] {
  const now = Date.now();

  return announcements
    .filter((announcement) => {
      const postedAt = announcement.posted_at ? Date.parse(announcement.posted_at) : now;
      return !Number.isNaN(postedAt) && now - postedAt <= ANNOUNCEMENT_WINDOW_MS;
    })
    .map((announcement) => {
      const courseName =
        (announcement.context_code && courseMap.get(announcement.context_code)) ||
        "Canvas";
      const preview = truncateText(stripHtml(announcement.message ?? ""));

      return {
        id: `kunngjoring-${announcement.id}`,
        title: `${courseName}: ${announcement.title}`,
        body: preview || "Ny kunngjøring i Canvas.",
        url: NOTIFICATIONS_DASHBOARD_URL,
        tag: `announcement-${announcement.id}`,
        createdAt: announcement.posted_at ? Date.parse(announcement.posted_at) : now,
      };
    });
}

type DeadlineAssignment = {
  id: number;
  name: string;
  due_at: string | null;
  points_possible?: number | null;
  submission?: { workflow_state?: string | null; submitted_at?: string | null } | null;
  course_name: string;
};

/** Beregn kompleksitetsbeskrivelse basert på poeng. */
function formaterKompleksitet(points: number | null | undefined): string {
  if (points == null || points <= 0) return "";
  if (points > POINTS_THRESHOLD_HIGH) return `Stor oppgave (${points} poeng)`;
  if (points > POINTS_THRESHOLD_MEDIUM) return `Middels oppgave (${points} poeng)`;
  return "";
}

/** Formater antall timer/dager til lesbar tekst. */
function formaterTidIgjen(ms: number): string {
  const timer = ms / (1000 * 60 * 60);
  if (timer < 1) return "under 1 time";
  if (timer < 24) return `${Math.round(timer)} timer`;
  const dager = Math.round(timer / 24);
  return dager === 1 ? "1 dag" : `${dager} dager`;
}

function buildDeadlineCandidates(
  assignments: DeadlineAssignment[],
): PushCandidate[] {
  const now = Date.now();

  return assignments
    .filter((assignment) => {
      if (!assignment.due_at) return false;
      if (isCanvasAssignmentSubmitted(assignment)) return false;

      const dueAt = Date.parse(assignment.due_at);
      return !Number.isNaN(dueAt) && dueAt > now && dueAt - now <= DEADLINE_WINDOW_MS;
    })
    .map((assignment) => {
      const dueAt = Date.parse(assignment.due_at!);
      const tidIgjen = formaterTidIgjen(dueAt - now);
      const kompleksitet = formaterKompleksitet(assignment.points_possible);
      const body = kompleksitet
        ? `Frist om ${tidIgjen}. ${kompleksitet}.`
        : `Frist om ${tidIgjen}.`;

      return {
        id: `frist-${assignment.id}`,
        title: `${assignment.course_name}: ${assignment.name}`,
        body,
        url: NOTIFICATIONS_DASHBOARD_URL,
        tag: `deadline-${assignment.id}`,
        createdAt: dueAt,
      };
    });
}

/**
 * Bygger tidlige fristvarsler (3-5 dager før frist).
 * Inkluderer kompleksitetsvurdering basert på poeng for å hjelpe brukeren prioritere.
 */
function buildEarlyDeadlineCandidates(
  assignments: DeadlineAssignment[],
): PushCandidate[] {
  const now = Date.now();

  return assignments
    .filter((assignment) => {
      if (!assignment.due_at) return false;
      if (isCanvasAssignmentSubmitted(assignment)) return false;

      const dueAt = Date.parse(assignment.due_at);
      const remaining = dueAt - now;
      return !Number.isNaN(dueAt) && remaining > EARLY_DEADLINE_MIN_MS && remaining <= EARLY_DEADLINE_MAX_MS;
    })
    .map((assignment) => {
      const dueAt = Date.parse(assignment.due_at!);
      const tidIgjen = formaterTidIgjen(dueAt - now);
      const kompleksitet = formaterKompleksitet(assignment.points_possible);
      const body = kompleksitet
        ? `Frist om ${tidIgjen}. ${kompleksitet} — vurder å begynne snart.`
        : `Frist om ${tidIgjen} — vurder å begynne snart.`;

      return {
        id: `tidlig-frist-${assignment.id}`,
        title: `${assignment.course_name}: ${assignment.name}`,
        body,
        url: NOTIFICATIONS_DASHBOARD_URL,
        tag: `early-deadline-${assignment.id}`,
        createdAt: dueAt,
      };
    });
}

function buildEventCandidates(
  events: Array<{
    id: number;
    title: string;
    start_at?: string | null;
    location_name?: string | null;
  }>,
): PushCandidate[] {
  const now = Date.now();

  return events
    .filter((event) => {
      if (!event.start_at) return false;
      const startAt = Date.parse(event.start_at);
      return !Number.isNaN(startAt) && startAt > now && startAt - now <= EVENT_WINDOW_MS;
    })
    .map((event) => ({
      id: `hendelse-${event.id}`,
      title: event.title,
      body: event.location_name
        ? `Starter snart. Sted: ${event.location_name}`
        : "Starter snart.",
      url: NOTIFICATIONS_DASHBOARD_URL,
      tag: `event-${event.id}`,
      createdAt: Date.parse(event.start_at ?? new Date().toISOString()),
    }));
}

async function buildUserPushCandidates(input: {
  canvasToken: string;
  canvasBaseUrl: string;
  preferences: BrowserPushPreferences;
}): Promise<PushCandidate[]> {
  const { canvasToken, canvasBaseUrl, preferences } = input;
  const courseResult = await fetchCourses(canvasToken, canvasBaseUrl);
  const courses = courseResult.data;
  const courseMap = new Map<string, string>();
  for (const course of courses) {
    courseMap.set(`course_${course.id}`, course.name);
  }

  const candidates: PushCandidate[] = [];

  if (preferences.announcements) {
    const announcementsResult = await fetchAllAnnouncements(canvasToken, canvasBaseUrl);
    candidates.push(
      ...buildAnnouncementCandidates(announcementsResult.data, courseMap),
    );
  }

  if ((preferences.deadlines || preferences.earlyDeadlines) && courses.length > 0) {
    const limit = pLimit(4);
    const assignmentResults = await Promise.allSettled(
      courses.map((course) =>
        limit(async () => {
          const response = await fetchAssignments(canvasToken, course.id, {
            bucket: "upcoming",
            baseUrl: canvasBaseUrl,
          });
          return response.data.map((assignment) => ({
            ...assignment,
            course_name: course.name,
          }));
        }),
      ),
    );

    const assignments = assignmentResults.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );

    if (preferences.deadlines) {
      candidates.push(...buildDeadlineCandidates(assignments));
    }
    if (preferences.earlyDeadlines) {
      candidates.push(...buildEarlyDeadlineCandidates(assignments));
    }
  }

  if (preferences.events) {
    const eventsResult = await fetchUpcomingEvents(canvasToken, canvasBaseUrl);
    candidates.push(...buildEventCandidates(eventsResult.data));
  }

  return candidates
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, WEB_PUSH_NOTIFICATION_LIMIT);
}

async function markPushIdsAsSent(
  userId: string,
  existingIds: readonly string[],
  newIds: readonly string[],
): Promise<void> {
  const keepFromExisting = Math.max(0, BROWSER_PUSH_SENT_IDS_MAX - newIds.length);
  const cappedExistingIds = keepFromExisting > 0
    ? existingIds.slice(-keepFromExisting)
    : [];
  const nextState = normalizeBrowserPushSentState({
    sentIds: [...cappedExistingIds, ...newIds],
  });

  await User.updateOne(
    { _id: userId, deletedAt: { $exists: false } },
    {
      $set: {
        browserPushSentState: nextState,
      },
    },
  );
}

async function processUserPushNotifications(user: {
  _id: mongoose.Types.ObjectId;
  canvasApiToken?: string;
  canvasBaseUrl?: string;
  browserPushPreferences?: BrowserPushPreferences;
  browserPushSentState?: { sentIds?: string[] };
}): Promise<void> {
  if (!user.canvasApiToken || !user.canvasBaseUrl) {
    return;
  }

  const preferences =
    normalizeBrowserPushPreferences(
      user.browserPushPreferences ?? createDefaultBrowserPushPreferences(),
    );
  if (!preferences.enabled) {
    return;
  }

  const subscriptions = await WebPushSubscriptionModel.find({
    userId: user._id,
  }).select("endpoint expirationTime keys");

  if (subscriptions.length === 0) {
    return;
  }

  const sentState = normalizeBrowserPushSentState(user.browserPushSentState);
  const sentIds = new Set(sentState.sentIds);
  let canvasToken: string;
  try {
    canvasToken = decrypt(user.canvasApiToken);
  } catch (error) {
    logger.warn(
      { err: error, userId: user._id.toString() },
      "Kunne ikke dekryptere Canvas-token for web-push",
    );
    return;
  }
  const candidates = await buildUserPushCandidates({
    canvasToken,
    canvasBaseUrl: user.canvasBaseUrl,
    preferences,
  });
  const freshCandidates = candidates.filter((candidate) => !sentIds.has(candidate.id));

  if (freshCandidates.length === 0) {
    return;
  }

  const deliveredIds: string[] = [];
  for (const candidate of freshCandidates) {
    const delivered = await sendPayloadToSubscriptions(subscriptions, candidate);
    if (delivered) {
      deliveredIds.push(candidate.id);
    } else {
      logger.info(
        { userId: user._id.toString(), candidateId: candidate.id },
        "Web-push-varsel ble ikke levert til noen abonnementer",
      );
    }
  }

  if (deliveredIds.length > 0) {
    await markPushIdsAsSent(
      user._id.toString(),
      sentState.sentIds,
      deliveredIds,
    );
  }
}

export function isWebPushConfigured(): boolean {
  return getWebPushConfig().configured;
}

export function getWebPushClientConfig(): { configured: boolean; publicKey: string } {
  const config = getWebPushConfig();
  return {
    configured: config.configured,
    publicKey: config.configured ? config.publicKey : "",
  };
}

export async function upsertWebPushSubscription(
  userId: string,
  subscription: WebPushSubscription,
  userAgent?: string,
): Promise<void> {
  const ownerUserId = new mongoose.Types.ObjectId(userId);
  try {
    const existing = await WebPushSubscriptionModel.findOne({
      endpoint: subscription.endpoint,
    }).select("userId keys");

    if (existing && !existing.userId.equals(ownerUserId)) {
      const sameKeyMaterial =
        existing.keys.auth === subscription.keys.auth &&
        existing.keys.p256dh === subscription.keys.p256dh;

      // Hindrer at en bruker overtar et endpoint uten å bevise at det er samme faktiske abonnement.
      if (!sameKeyMaterial) {
        throw new WebPushSubscriptionConflictError();
      }
    }

    await WebPushSubscriptionModel.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        $set: {
          userId: ownerUserId,
          endpoint: subscription.endpoint,
          expirationTime: subscription.expirationTime ?? null,
          keys: subscription.keys,
          userAgent: userAgent?.slice(0, 500),
        },
      },
      { upsert: true, returnDocument: "after" },
    );
  } catch (error) {
    if (isMongoDuplicateKeyError(error)) {
      // Sjelden race ved samtidig upsert på samme endpoint: gjør ett siste ikke-upsert-forsøk.
      await WebPushSubscriptionModel.findOneAndUpdate(
        { endpoint: subscription.endpoint },
        {
          $set: {
            userId: ownerUserId,
            endpoint: subscription.endpoint,
            expirationTime: subscription.expirationTime ?? null,
            keys: subscription.keys,
            userAgent: userAgent?.slice(0, 500),
          },
        },
      );
      return;
    }
    throw error;
  }
}

export async function removeWebPushSubscription(
  userId: string,
  endpoint: string,
): Promise<void> {
  await WebPushSubscriptionModel.deleteOne({
    userId: new mongoose.Types.ObjectId(userId),
    endpoint,
  });
}

export async function sendTestWebPush(userId: string): Promise<boolean> {
  if (!ensureWebPushConfigured()) {
    return false;
  }

  const subscriptions = await WebPushSubscriptionModel.find({
    userId: new mongoose.Types.ObjectId(userId),
  }).select("endpoint expirationTime keys");

  if (subscriptions.length === 0) {
    return false;
  }

  return sendPayloadToSubscriptions(subscriptions, {
    id: `test-${Date.now()}`,
    title: "StudyWise-varsler er aktivert",
    body: "Du vil nå få nettleservarsler for hendelser og KI-svar du har slått på.",
    url: NOTIFICATIONS_DASHBOARD_URL,
    tag: "studywise-test-push",
    createdAt: Date.now(),
  });
}

export async function sendAICompletionWebPush(input: {
  userId: string;
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}): Promise<boolean> {
  if (!ensureWebPushConfigured()) {
    return false;
  }

  const user = await User.findOne({ _id: input.userId, deletedAt: { $exists: false } })
    .select("browserPushPreferences")
    .lean<{ browserPushPreferences?: Partial<BrowserPushPreferences> } | null>();

  if (!user) {
    return false;
  }

  const preferences = normalizeBrowserPushPreferences(
    user.browserPushPreferences ?? createDefaultBrowserPushPreferences(),
  );
  if (!preferences.enabled || !preferences.aiResponses) {
    return false;
  }

  const subscriptions = await WebPushSubscriptionModel.find({
    userId: new mongoose.Types.ObjectId(input.userId),
  }).select("endpoint expirationTime keys");

  if (subscriptions.length === 0) {
    return false;
  }

  return sendPayloadToSubscriptions(subscriptions, {
    id: `ki-svar-${Date.now()}`,
    title: input.title ?? "StudyWise: KI-svaret er klart",
    body: input.body ?? "Samtalen din har fått et nytt svar i StudyWise.",
    url: input.url ?? "/dashboard",
    tag: input.tag ?? "studywise-ai-response",
    createdAt: Date.now(),
  });
}

export async function processWebPushNotifications(): Promise<void> {
  if (!ensureWebPushConfigured()) {
    return;
  }

  if (webPushBatchRunning) {
    logger.info("Hopper over web-push-sjekk fordi forrige kjøring fortsatt pågår");
    return;
  }

  webPushBatchRunning = true;
  try {
    const limit = pLimit(3);
    let lastProcessedUserId: mongoose.Types.ObjectId | null = null;

    while (true) {
      const query: Record<string, unknown> = {
        deletedAt: { $exists: false },
        canvasBaseUrl: { $exists: true, $ne: null },
        browserPushPreferences: { $exists: true },
        "browserPushPreferences.enabled": true,
      };

      if (lastProcessedUserId) {
        query._id = { $gt: lastProcessedUserId };
      }

      const users = await User.find(query)
        .sort({ _id: 1 })
        .select("+canvasApiToken browserPushPreferences browserPushSentState canvasBaseUrl")
        .limit(WEB_PUSH_USER_BATCH_LIMIT);

      if (users.length === 0) {
        break;
      }

      await Promise.allSettled(
        users.map((user) =>
          limit(async () => {
            try {
              await processUserPushNotifications(user);
            } catch (error) {
              logger.warn(
                { err: error, userId: user._id.toString() },
                "Periodisk web-push-sjekk feilet for bruker",
              );
            }
          }),
        ),
      );

      const tailUser = users[users.length - 1];
      if (!tailUser || users.length < WEB_PUSH_USER_BATCH_LIMIT) {
        break;
      }
      lastProcessedUserId = tailUser._id;
    }
  } finally {
    webPushBatchRunning = false;
  }
}

export function startWebPushPolling() {
  if (!isWebPushConfigured()) {
    logger.warn(
      "Web-push er deaktivert fordi VAPID-konfigurasjon mangler",
    );
    return null;
  }

  const interval = setInterval(() => {
    void processWebPushNotifications().catch((error) => {
      logger.warn({ err: error }, "Periodisk web-push-utsending feilet");
    });
  }, WEB_PUSH_POLL_INTERVAL_MS);
  interval.unref?.();
  return interval;
}
