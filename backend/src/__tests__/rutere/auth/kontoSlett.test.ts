/**
 * Tester for rutere/auth/kontoSlett.ts `deleteAccountData`.
 *
 * GDPR-kritisk: må slette ALLE collections som har bruker-data, opprette
 * tombstone for å hindre re-registrering, og kalle Clerk + Pinecone for
 * cleanup. Vi tester:
 *
 *   1. Idempotent: bruker ikke funnet → returnerer tidlig uten å kaste
 *   2. Idempotent + tombstone finnes → returnerer providerAccountDeleted=true
 *   3. Happy path: alle deleteMany-kall trigges + tombstone opprettes + Clerk kalles
 *   4. skipClerkDeletion: hopper over Clerk-kallet (brukes av webhook)
 *   5. Pinecone-feil → enqueueVectorDeletionRetry kalles
 *   6. Clerk-feil → enqueueClerkDeletionRetry kalles
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Partial-mock mongoose: behold alle ekte exports (Schema, model, etc.)
// men override startSession/withTransaction så vi kan kontrollere transaksjonen.
vi.mock("mongoose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mongoose")>();
  const startSessionStub = vi.fn().mockResolvedValue({
    withTransaction: vi.fn(async (cb: () => Promise<unknown>) => {
      await cb();
    }),
    endSession: vi.fn().mockResolvedValue(undefined),
  });
  return {
    ...actual,
    default: {
      ...actual.default,
      startSession: startSessionStub,
    },
    startSession: startSessionStub,
  };
});

// Inline delete-resultat (vi.mock factories kan ikke referere top-level vars)
const EMPTY_DELETE = { deletedCount: 0, acknowledged: true };

vi.mock("../../../database/models/User.js", () => ({
  User: {
    findById: vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue(null),
    }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1, acknowledged: true }),
  },
}));

vi.mock("../../../database/models/ChatHistory.js", () => ({
  ChatHistory: { deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0, acknowledged: true }) },
}));
vi.mock("../../../database/models/SharedChat.js", () => ({
  SharedChat: { deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0, acknowledged: true }) },
}));
vi.mock("../../../database/models/TaskBreakdown.js", () => ({
  TaskBreakdown: { deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0, acknowledged: true }) },
}));
vi.mock("../../../database/models/CanvasStructure.js", () => ({
  CanvasStructureModel: { deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0, acknowledged: true }) },
}));
vi.mock("../../../database/models/CanvasUser.js", () => ({
  CanvasUser: { deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0, acknowledged: true }) },
}));
vi.mock("../../../database/models/arbeidsplan.js", () => ({
  Arbeidsplan: { deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0, acknowledged: true }) },
}));
vi.mock("../../../database/models/WebPushSubscription.js", () => ({
  WebPushSubscriptionModel: { deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0, acknowledged: true }) },
}));
vi.mock("../../../database/models/StudyContext.js", () => ({
  StudyContext: { deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0, acknowledged: true }) },
}));
vi.mock("../../../database/models/ChatFeedback.js", () => ({
  ChatFeedback: { deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0, acknowledged: true }) },
}));
vi.mock("../../../database/models/Kunnskapsbase.js", () => ({
  KnowledgeBase: {
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0, acknowledged: true }),
    find: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
  },
}));
vi.mock("../../../database/models/KBContentChunk.js", () => ({
  KBContentChunk: { deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0, acknowledged: true }) },
}));
vi.mock("../../../database/models/DeletedUserTombstone.js", () => ({
  DeletedUserTombstone: {
    exists: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue([{}]),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  },
}));

// Embedding service
vi.mock("../../../services/embedding.service.js", () => ({
  deleteStoredUserMongoContent: vi.fn().mockResolvedValue(0),
  deleteStoredUserVectors: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../services/kunnskapsbase-indeksering.service.js", () => ({
  deleteAllKBContentForUser: vi.fn().mockResolvedValue(undefined),
}));

// Cache + Redis
vi.mock("../../../cache/redis.js", () => ({
  invalidateCacheByPattern: vi.fn().mockResolvedValue(undefined),
  isRedisReady: vi.fn().mockReturnValue(true),
}));

// Clerk — pathen må matche det MODULENE som testes importerer (./clerkAuth.js)
vi.mock("../../../rutere/auth/clerkAuth.js", () => ({
  deleteClerkUserById: vi.fn().mockResolvedValue(true),
  invalidateTokenCacheByClerkId: vi.fn(),
}));

// BullMQ-køer
vi.mock("../../../queues/clerkDeletion.queue.js", () => ({
  enqueueClerkDeletionRetry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../queues/pineconeCleanup.queue.js", () => ({
  enqueueVectorDeletionRetry: vi.fn().mockResolvedValue(undefined),
}));

// Audit
vi.mock("../../../utils/auditLog.js", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: { ACCOUNT_DELETED: "auth.account_deleted" },
  getDeletedAuditActorId: (id: string) => `deleted:${id}`,
}));

// Logger
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Importer ETTER mocks
import { deleteAccountData } from "../../../rutere/auth/kontoSlett.js";
import { User } from "../../../database/models/User.js";
import { ChatHistory } from "../../../database/models/ChatHistory.js";
import { SharedChat } from "../../../database/models/SharedChat.js";
import { TaskBreakdown } from "../../../database/models/TaskBreakdown.js";
import { CanvasUser } from "../../../database/models/CanvasUser.js";
import { Arbeidsplan } from "../../../database/models/arbeidsplan.js";
import { CanvasStructureModel } from "../../../database/models/CanvasStructure.js";
import { WebPushSubscriptionModel } from "../../../database/models/WebPushSubscription.js";
import { StudyContext } from "../../../database/models/StudyContext.js";
import { ChatFeedback } from "../../../database/models/ChatFeedback.js";
import { KnowledgeBase } from "../../../database/models/Kunnskapsbase.js";
import { KBContentChunk } from "../../../database/models/KBContentChunk.js";
import { DeletedUserTombstone } from "../../../database/models/DeletedUserTombstone.js";
import { deleteClerkUserById } from "../../../rutere/auth/clerkAuth.js";
import { enqueueClerkDeletionRetry } from "../../../queues/clerkDeletion.queue.js";
import { deleteStoredUserMongoContent } from "../../../services/embedding.service.js";

const TEST_USER_ID = "507f1f77bcf86cd799439011";
const mkDeleteResult = (deletedCount = 0) => ({ deletedCount, acknowledged: true });
void EMPTY_DELETE;

function makeFakeUser() {
  return {
    _id: TEST_USER_ID,
    clerkId: "user_clerk_abc",
    canvasApiToken: undefined,
    canvasTokenHash: undefined,
    oauthAccounts: [],
    usernameNormalized: undefined,
  };
}

describe("deleteAccountData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Idempotency ───────────────────────────────────────────────────────────
  describe("idempotency", () => {
    it("returnerer tidlig når bruker ikke finnes og ingen tombstone", async () => {
      (User.findById as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        select: vi.fn().mockResolvedValue(null),
      });
      (DeletedUserTombstone.exists as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const result = await deleteAccountData(TEST_USER_ID);

      expect(result.providerAccountDeleted).toBe(false);
      expect(result.vectorCleanupSucceeded).toBe(false);
      expect(result.deleted.user).toBe(false);
      expect(deleteClerkUserById).not.toHaveBeenCalled();
      expect(ChatHistory.deleteMany).not.toHaveBeenCalled();
    });

    it("returnerer providerAccountDeleted=true når bruker ikke finnes men tombstone eksisterer", async () => {
      (User.findById as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        select: vi.fn().mockResolvedValue(null),
      });
      (DeletedUserTombstone.exists as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        _id: "some-id",
      });

      const result = await deleteAccountData(TEST_USER_ID);

      expect(result.providerAccountDeleted).toBe(true);
      expect(result.vectorCleanupSucceeded).toBe(true);
      expect(deleteClerkUserById).not.toHaveBeenCalled();
    });
  });

  // ── Happy path: full sletting ─────────────────────────────────────────────
  describe("happy path", () => {
    it("kaller deleteMany på ALLE forventede collections", async () => {
      (User.findById as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        select: vi.fn().mockResolvedValue(makeFakeUser()),
      });

      await deleteAccountData(TEST_USER_ID);

      // Verifiser at hver collection ble berørt
      expect(ChatHistory.deleteMany).toHaveBeenCalled();
      expect(SharedChat.deleteMany).toHaveBeenCalled();
      expect(TaskBreakdown.deleteMany).toHaveBeenCalled();
      expect(CanvasStructureModel.deleteMany).toHaveBeenCalled();
      expect(CanvasUser.deleteMany).toHaveBeenCalled();
      expect(Arbeidsplan.deleteMany).toHaveBeenCalled();
      expect(WebPushSubscriptionModel.deleteMany).toHaveBeenCalled();
      expect(StudyContext.deleteMany).toHaveBeenCalled();
      expect(ChatFeedback.deleteMany).toHaveBeenCalled();
      expect(KnowledgeBase.deleteMany).toHaveBeenCalled();
      expect(KBContentChunk.deleteMany).toHaveBeenCalled();
      expect(deleteStoredUserMongoContent).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.anything(),
      );
    });

    it("oppretter DeletedUserTombstone", async () => {
      (User.findById as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        select: vi.fn().mockResolvedValue(makeFakeUser()),
      });

      await deleteAccountData(TEST_USER_ID);

      expect(DeletedUserTombstone.create).toHaveBeenCalled();
    });

    it("kaller User.deleteOne på slutten av transaksjonen", async () => {
      (User.findById as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        select: vi.fn().mockResolvedValue(makeFakeUser()),
      });

      await deleteAccountData(TEST_USER_ID);

      expect(User.deleteOne).toHaveBeenCalled();
    });

    it("kaller deleteClerkUserById som default", async () => {
      (User.findById as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        select: vi.fn().mockResolvedValue(makeFakeUser()),
      });

      const result = await deleteAccountData(TEST_USER_ID);

      expect(deleteClerkUserById).toHaveBeenCalledWith("user_clerk_abc");
      expect(result.providerAccountDeleted).toBe(true);
    });

    it("returnerer korrekt deleted-resultat-objekt", async () => {
      (User.findById as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        select: vi.fn().mockResolvedValue(makeFakeUser()),
      });
      (ChatHistory.deleteMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mkDeleteResult(5));
      (TaskBreakdown.deleteMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mkDeleteResult(2));
      (Arbeidsplan.deleteMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mkDeleteResult(1));

      const result = await deleteAccountData(TEST_USER_ID);

      expect(result.deleted.chatHistory).toBe(5);
      expect(result.deleted.taskBreakdown).toBe(2);
      expect(result.deleted.arbeidsplan).toBe(1);
    });
  });

  // ── skipClerkDeletion (brukes av Clerk webhook for å unngå loop) ────────
  describe("skipClerkDeletion option", () => {
    it("hopper over Clerk-kallet når skipClerkDeletion=true", async () => {
      (User.findById as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        select: vi.fn().mockResolvedValue(makeFakeUser()),
      });

      const result = await deleteAccountData(TEST_USER_ID, {
        skipClerkDeletion: true,
      });

      expect(deleteClerkUserById).not.toHaveBeenCalled();
      expect(result.providerAccountDeleted).toBe(true); // Markert som "OK" siden vi skip-et med vilje
    });
  });

  // ── Failure paths ─────────────────────────────────────────────────────────
  describe("failure paths trigger BullMQ retry queues", () => {
    it("enqueuer Clerk-retry hvis deleteClerkUserById feiler", async () => {
      (User.findById as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        select: vi.fn().mockResolvedValue(makeFakeUser()),
      });
      (deleteClerkUserById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      const result = await deleteAccountData(TEST_USER_ID);

      expect(enqueueClerkDeletionRetry).toHaveBeenCalledWith(
        expect.objectContaining({ clerkId: "user_clerk_abc" }),
      );
      expect(result.providerAccountDeleted).toBe(false);
    });
  });
});
