--
-- PostgreSQL database dump
--

\restrict bwht96jfvD77xWkMlqB4EFX0mJquZmm9o9HiDEYzK13ykxb85Cckfea3kMbI9ZV

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: ArtifactState; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ArtifactState" AS ENUM (
    'none',
    'materializing',
    'stored',
    'failed'
);


--
-- Name: AuditTargetType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AuditTargetType" AS ENUM (
    'subscription',
    'subscription_plan',
    'point',
    'order',
    'TEAM',
    'TEAM_MEMBER',
    'PROJECT',
    'PROJECT_MEMBER',
    'COLLAB_LEASE'
);


--
-- Name: CreditType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."CreditType" AS ENUM (
    'regular',
    'subscription'
);


--
-- Name: IntentStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."IntentStatus" AS ENUM (
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'VOIDED',
    'UNKNOWN'
);


--
-- Name: JoinRequestStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."JoinRequestStatus" AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED'
);


--
-- Name: LightingTaskStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."LightingTaskStatus" AS ENUM (
    'pending',
    'processing',
    'success',
    'failed'
);


--
-- Name: MaintenanceStage; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."MaintenanceStage" AS ENUM (
    'REQUESTED',
    'FREEZING',
    'DRAINING',
    'DRAINED',
    'EXPORTING',
    'REBUILDING',
    'SWITCHING',
    'VERIFYING',
    'COMPLETED',
    'FAILED',
    'ABORTED'
);


--
-- Name: MediaFactState; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."MediaFactState" AS ENUM (
    'pending',
    'published',
    'dead'
);


--
-- Name: MediaStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."MediaStatus" AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed'
);


--
-- Name: ProbeState; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ProbeState" AS ENUM (
    'pending',
    'running',
    'done',
    'failed',
    'skipped'
);


--
-- Name: ProjectRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ProjectRole" AS ENUM (
    'PROJECT_OWNER',
    'PROJECT_EDITOR',
    'PROJECT_VIEWER'
);


--
-- Name: ProjectionState; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ProjectionState" AS ENUM (
    'pending',
    'projecting',
    'projected',
    'orphaned',
    'superseded',
    'dead'
);


--
-- Name: RechargeKind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."RechargeKind" AS ENUM (
    'credits',
    'subscription'
);


--
-- Name: Role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Role" AS ENUM (
    'USER',
    'ADMIN'
);


--
-- Name: SubscriptionOrderStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SubscriptionOrderStatus" AS ENUM (
    'PENDING',
    'SUCCESS',
    'FAILED',
    'CLOSED'
);


--
-- Name: SubscriptionOrderType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SubscriptionOrderType" AS ENUM (
    'new_purchase',
    'upgrade',
    'renewal'
);


--
-- Name: SubscriptionPeriod; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SubscriptionPeriod" AS ENUM (
    'monthly',
    'quarterly',
    'annually'
);


--
-- Name: SubscriptionStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SubscriptionStatus" AS ENUM (
    'active',
    'expired',
    'upgraded'
);


--
-- Name: SubscriptionTier; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SubscriptionTier" AS ENUM (
    'basic',
    'pro',
    'max',
    'ultra'
);


--
-- Name: TeamCreditTransactionType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TeamCreditTransactionType" AS ENUM (
    'recharge',
    'subscription_grant',
    'expire_clear',
    'register_grant',
    'upgrade_clear',
    'admin_grant',
    'admin_clear',
    'release',
    'refund',
    'reserve',
    'settle'
);


--
-- Name: TeamOrderStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TeamOrderStatus" AS ENUM (
    'PENDING',
    'SUCCESS',
    'CLOSED'
);


--
-- Name: TeamRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TeamRole" AS ENUM (
    'OWNER',
    'ADMIN',
    'MEMBER'
);


--
-- Name: TeamStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TeamStatus" AS ENUM (
    'ACTIVE',
    'DISBANDED',
    'DISBANDING'
);


--
-- Name: TeamSubscriptionStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TeamSubscriptionStatus" AS ENUM (
    'active',
    'expired'
);


--
-- Name: VideoWorkStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."VideoWorkStatus" AS ENUM (
    'DRAFT',
    'PUBLISHED'
);


--
-- Name: ledger_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ledger_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF current_setting('app.ledger_tx', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'LEDGER_SINGLE_WRITER: % 写操作必须经 CreditLedgerService 事务（SET LOCAL app.ledger_tx）', TG_TABLE_NAME;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: AIModel; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AIModel" (
    id text NOT NULL,
    "nodeTypeId" text NOT NULL,
    name text NOT NULL,
    provider text NOT NULL,
    "apiUrl" text NOT NULL,
    "apiKey" text,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    recommended boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "apiModelName" text,
    "providerLabel" text
);


--
-- Name: Account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Account" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    password text,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamp(3) without time zone,
    "refreshTokenExpiresAt" timestamp(3) without time zone,
    scope text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Announcement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Announcement" (
    id text NOT NULL,
    message character varying(200) NOT NULL,
    "linkText" character varying(32),
    "linkUrl" character varying(500),
    "bgColor" character varying(16) DEFAULT '#0f2761'::character varying NOT NULL,
    "textColor" character varying(16) DEFAULT '#ffffff'::character varying NOT NULL,
    active boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ArtifactProjection; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ArtifactProjection" (
    id text NOT NULL,
    "artifactId" text NOT NULL,
    "artifactRev" integer NOT NULL,
    "projectId" text NOT NULL,
    "nodeId" text NOT NULL,
    "targetField" text NOT NULL,
    "targetItemId" text DEFAULT ''::text NOT NULL,
    "mediaId" text,
    "resultText" text,
    state public."ProjectionState" DEFAULT 'pending'::public."ProjectionState" NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    "leaseUntil" timestamp(3) without time zone,
    "runId" text,
    "nextAttemptAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastError" character varying(512),
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "projectedAt" timestamp(3) without time zone,
    CONSTRAINT artifact_projection_target_field_domain CHECK (("targetField" = ANY (ARRAY['fileId'::text, 'result'::text])))
);


--
-- Name: AuditLog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AuditLog" (
    id text NOT NULL,
    "operatorId" text NOT NULL,
    "operatorName" text NOT NULL,
    "teamId" text,
    "targetType" public."AuditTargetType" NOT NULL,
    "targetId" text NOT NULL,
    action text NOT NULL,
    "beforeValue" jsonb,
    "afterValue" jsonb,
    remark text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: CanaryPin; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CanaryPin" (
    "projectId" text NOT NULL,
    status text DEFAULT 'CAPTURING'::text NOT NULL,
    generation integer NOT NULL,
    "snapshotRev" bigint NOT NULL,
    "stateSeq" bigint NOT NULL,
    "pgSeqAt" bigint NOT NULL,
    "contentHash" character(64),
    "hashSkipped" boolean DEFAULT false NOT NULL,
    "hashVersion" integer NOT NULL,
    "stateVector" bytea,
    "leaseUntil" timestamp(3) without time zone NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "semanticDigest" character(64)
);


--
-- Name: CanvasDoc; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CanvasDoc" (
    "projectId" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    generation integer DEFAULT 0 NOT NULL,
    "schemaVersion" integer DEFAULT 3 NOT NULL,
    "currentSnapshotRev" bigint DEFAULT 0 NOT NULL,
    "maintenanceId" text,
    "pgSeq" bigint DEFAULT 0 NOT NULL,
    "purgeBelowSeq" bigint,
    "vacuumEpoch" integer DEFAULT 0 NOT NULL,
    "walCheckpointSeq" bigint DEFAULT 0 NOT NULL,
    "bindingsDirty" boolean DEFAULT false NOT NULL,
    "mediaBindingSeq" bigint DEFAULT 0 NOT NULL,
    CONSTRAINT canvas_doc_watermark_order_check CHECK (("pgSeq" <= "walCheckpointSeq"))
);


--
-- Name: CanvasDocCoalesced; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CanvasDocCoalesced" (
    "projectId" text NOT NULL,
    generation integer NOT NULL,
    seq bigint NOT NULL,
    "updateHash" character(64) NOT NULL,
    "sourceSeq" bigint NOT NULL,
    reason text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: CanvasDocSnapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CanvasDocSnapshot" (
    "projectId" text NOT NULL,
    generation integer NOT NULL,
    "snapshotRev" bigint NOT NULL,
    "stateSeq" bigint NOT NULL,
    state bytea NOT NULL,
    "stateHash" character(64) NOT NULL,
    "vacuumEpoch" integer NOT NULL,
    "schemaVersion" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT canvas_doc_snapshot_state_size_check CHECK ((octet_length(state) <= 16777216))
);


--
-- Name: CanvasDocUpdate; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CanvasDocUpdate" (
    "projectId" text NOT NULL,
    seq bigint NOT NULL,
    update bytea NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "actorRanges" jsonb,
    "firstWalSeq" bigint NOT NULL,
    "frameCount" integer NOT NULL,
    generation integer NOT NULL,
    "updateHash" character(64) NOT NULL,
    CONSTRAINT canvas_doc_update_frame_count_pos CHECK (("frameCount" > 0)),
    CONSTRAINT canvas_doc_update_payload_le_16mib CHECK ((octet_length(update) <= 16777216)),
    CONSTRAINT canvas_doc_update_seq_ge_first_wal_seq CHECK ((seq >= "firstWalSeq"))
);


--
-- Name: CanvasProject; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CanvasProject" (
    id text NOT NULL,
    name text NOT NULL,
    "userId" text,
    "teamId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "lifecycleState" text DEFAULT 'ACTIVE'::text NOT NULL,
    origin text
);


--
-- Name: CollabCanaryCursor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CollabCanaryCursor" (
    "projectId" text NOT NULL,
    generation integer NOT NULL,
    "lastCheckedAt" timestamp(3) without time zone NOT NULL,
    "lastResult" text NOT NULL,
    "nextDueAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: CollabJobCursor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CollabJobCursor" (
    job text NOT NULL,
    "lastKey" text,
    "lastGap" jsonb,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: CollabLease; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CollabLease" (
    scope text NOT NULL,
    owner text,
    epoch bigint DEFAULT 0 NOT NULL,
    "expiresAt" timestamp(3) with time zone,
    "renewedAt" timestamp(3) with time zone
);


--
-- Name: CollabOpsGate; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CollabOpsGate" (
    gate text NOT NULL,
    "projectId" text DEFAULT ''::text NOT NULL,
    state text DEFAULT 'OPEN'::text NOT NULL,
    version bigint DEFAULT 0 NOT NULL,
    "frozenAt" timestamp(3) without time zone,
    "frozenBy" text,
    "unfrozenAt" timestamp(3) without time zone,
    reason text
);


--
-- Name: ContentCard; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ContentCard" (
    id text NOT NULL,
    title text NOT NULL,
    "coverUrl" text NOT NULL,
    tags text[],
    "desc" text NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: DeliveryFence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DeliveryFence" (
    "projectId" text NOT NULL,
    "nodeId" text NOT NULL,
    "fenceSeq" bigint NOT NULL,
    state text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: DocAuditEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DocAuditEvent" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    kind text NOT NULL,
    "userId" text NOT NULL,
    "requestId" text,
    payload jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ExecutionInput; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ExecutionInput" (
    "requestId" text NOT NULL,
    encoding text NOT NULL,
    content bytea NOT NULL,
    "contentHash" character(64) NOT NULL,
    "rawBytes" integer NOT NULL,
    "storedBytes" integer NOT NULL,
    "schemaVersion" integer NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ExecutionNodePlan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ExecutionNodePlan" (
    "requestId" text NOT NULL,
    "nodeId" text NOT NULL,
    "order" integer NOT NULL,
    type text NOT NULL,
    model text,
    resolution text,
    "styleId" text,
    "pricingRuleId" text,
    "creditCost" integer DEFAULT 0 NOT NULL,
    "reservedCredit" integer DEFAULT 0 NOT NULL,
    "paramsHash" character(64) NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    "generationIntentId" text,
    "execSeq" bigint
);


--
-- Name: ExecutionOutbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ExecutionOutbox" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    generation integer NOT NULL,
    "businessKey" text NOT NULL,
    kind text NOT NULL,
    payload jsonb,
    state text DEFAULT 'PENDING'::text NOT NULL,
    "claimOwner" text,
    "claimUntilMs" bigint,
    attempts integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ExecutionRequest; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ExecutionRequest" (
    id text NOT NULL,
    "requestId" text NOT NULL,
    "projectId" text NOT NULL,
    generation integer NOT NULL,
    "historyId" text NOT NULL,
    "docSeq" bigint NOT NULL,
    "frozenDocSeq" bigint NOT NULL,
    "userId" text NOT NULL,
    "teamId" text NOT NULL,
    kind text NOT NULL,
    state text DEFAULT 'ADMITTED'::text NOT NULL,
    "reservedCredit" integer DEFAULT 0 NOT NULL,
    "totalCredit" integer DEFAULT 0 NOT NULL,
    "planHash" character(64) NOT NULL,
    "inputHash" character(64) NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Folder; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Folder" (
    id text NOT NULL,
    name character varying(255) NOT NULL,
    "parentId" text,
    "userId" text NOT NULL,
    "teamId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: GenerationIntent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."GenerationIntent" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "nodeId" text NOT NULL,
    "userId" text NOT NULL,
    "intentId" text NOT NULL,
    kind text NOT NULL,
    "paramsHash" text NOT NULL,
    status public."IntentStatus" DEFAULT 'RUNNING'::public."IntentStatus" NOT NULL,
    "jobId" text,
    "creditsConsumed" integer DEFAULT 0 NOT NULL,
    "reservedCredits" integer DEFAULT 0 NOT NULL,
    attempts integer DEFAULT 1 NOT NULL,
    "resultRef" text,
    error text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "completedAt" timestamp(3) without time zone,
    "creditCost" integer NOT NULL,
    "durationId" text,
    "modelId" text,
    "pricingRuleId" text,
    "resolutionId" text,
    "teamId" text NOT NULL,
    "heartbeatAt" timestamp(3) without time zone NOT NULL,
    "deadlineAt" timestamp(3) without time zone NOT NULL,
    "startedAt" timestamp(3) without time zone,
    "idemKey" text NOT NULL,
    "gestureKey" text,
    "providerTaskId" text,
    "traceId" text,
    "execProjectedExecSeq" bigint,
    "execSeq" bigint NOT NULL,
    "providerRequestId" text,
    "reservedExecSeq" bigint,
    "resultText" text,
    "claimArtifactRev" integer,
    "executionRequestId" text,
    CONSTRAINT intent_credit_cost_non_negative CHECK ((("creditCost" >= 0) AND ("reservedCredits" >= 0) AND ("creditsConsumed" >= 0)))
);


--
-- Name: HomeBanner; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."HomeBanner" (
    id text NOT NULL,
    title character varying(128),
    subtitle character varying(256),
    "linkUrl" character varying(500),
    "imageKey" character varying(255) NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: LifecycleObligation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LifecycleObligation" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "nodeId" text NOT NULL,
    kind text NOT NULL,
    "walSeq" bigint NOT NULL,
    state text DEFAULT 'PENDING'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    "claimOwner" text,
    "claimUntilMs" bigint,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: LightingTask; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LightingTask" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "nodeId" text NOT NULL,
    "projectId" text,
    "originalImageUrl" character varying(512) NOT NULL,
    "resultImageUrl" character varying(512),
    "resultMediaId" text,
    params jsonb NOT NULL,
    status public."LightingTaskStatus" DEFAULT 'pending'::public."LightingTaskStatus" NOT NULL,
    "costCredits" integer DEFAULT 0 NOT NULL,
    "errorMessage" text,
    "teamId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "completedAt" timestamp(3) without time zone
);


--
-- Name: MaintenanceOperation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MaintenanceOperation" (
    "maintenanceId" text NOT NULL,
    "projectId" text NOT NULL,
    stage public."MaintenanceStage" NOT NULL,
    status text NOT NULL,
    attempt integer DEFAULT 0 NOT NULL,
    "sourceGeneration" integer NOT NULL,
    "targetGeneration" integer NOT NULL,
    "schemaVersion" integer NOT NULL,
    "cutoffPgSeq" bigint NOT NULL,
    "drainedAt" timestamp(3) without time zone,
    error text,
    "idempotencyKey" text NOT NULL,
    "leaseOwner" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: MaterialFolder; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MaterialFolder" (
    id text NOT NULL,
    name text NOT NULL,
    "parentId" text,
    "userId" text NOT NULL,
    "teamId" text NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "isDefault" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


--
-- Name: MaterializeRun; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MaterializeRun" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "nodeId" text NOT NULL,
    "expectedExecSeq" bigint NOT NULL,
    state text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Media" (
    id text NOT NULL,
    "userId" text NOT NULL,
    bucket text DEFAULT 'flowai'::text NOT NULL,
    key text NOT NULL,
    "originalName" text NOT NULL,
    "mimeType" text NOT NULL,
    size bigint NOT NULL,
    "projectId" text,
    "nodeId" text,
    "taskId" text,
    type text NOT NULL,
    metadata jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "folderId" text,
    "isFavorite" boolean DEFAULT false NOT NULL,
    "thumbnailKey" text,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "teamId" text NOT NULL,
    "clientUploadId" text,
    "factVersion" bigint DEFAULT 0 NOT NULL,
    "nextMaterializeAt" timestamp(3) without time zone,
    "nextProbeAt" timestamp(3) without time zone,
    "pendingExpiresAt" timestamp(3) without time zone,
    "probeAttempts" integer DEFAULT 0 NOT NULL,
    "probeError" character varying(512),
    "probeFailureKind" text,
    "probeLeaseUntil" timestamp(3) without time zone,
    "probeRunId" text,
    "probeState" public."ProbeState" DEFAULT 'pending'::public."ProbeState" NOT NULL,
    "probedAt" timestamp(3) without time zone,
    "processingAttempts" integer DEFAULT 0 NOT NULL,
    "processingLeaseUntil" timestamp(3) without time zone,
    "sourceRegistrationKey" text,
    "sourceUrl" text,
    "sourceUrlExpiresAt" timestamp(3) without time zone,
    status public."MediaStatus" DEFAULT 'pending'::public."MediaStatus" NOT NULL,
    "artifactIndex" integer DEFAULT 0 NOT NULL,
    "naturalHeight" integer,
    "naturalRotation" integer,
    "naturalSource" text,
    "naturalWidth" integer,
    "objectKey" text,
    "objectSha256" text,
    "sniffedMimeType" text,
    "sourceExecSeq" bigint,
    "sourceIntentRowId" text,
    "deletionState" text DEFAULT 'ACTIVE'::text NOT NULL,
    CONSTRAINT "Media_deletionState_check" CHECK (("deletionState" = ANY (ARRAY['ACTIVE'::text, 'DELETING'::text])))
);


--
-- Name: MediaBinding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MediaBinding" (
    id text NOT NULL,
    "mediaId" text NOT NULL,
    "projectId" text NOT NULL,
    "nodeId" text NOT NULL,
    "teamId" text NOT NULL,
    role text DEFAULT 'primary'::text NOT NULL,
    "targetField" text DEFAULT 'fileId'::text NOT NULL,
    "targetItemId" text DEFAULT ''::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT media_binding_target_field_domain CHECK (("targetField" = ANY (ARRAY['fileId'::text, 'referenceImage'::text, 'referenceVideo'::text, 'referenceAudio'::text, 'images'::text, 'allImages'::text, 'trimmedFileId'::text, 'videoFileId'::text, 'audioFileId'::text])))
);


--
-- Name: MediaFact; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MediaFact" (
    "mediaId" text NOT NULL,
    "factType" text NOT NULL,
    "factVersion" bigint NOT NULL,
    payload jsonb NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL,
    CONSTRAINT "MediaFact_factType_check" CHECK (("factType" = ANY (ARRAY['state'::text, 'natural'::text])))
);


--
-- Name: MediaFactOutbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MediaFactOutbox" (
    id text NOT NULL,
    "mediaId" text NOT NULL,
    "projectId" text NOT NULL,
    "factVersion" bigint NOT NULL,
    "factType" text NOT NULL,
    payload jsonb NOT NULL,
    state public."MediaFactState" DEFAULT 'pending'::public."MediaFactState" NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    "leaseUntil" timestamp(3) without time zone,
    "nextAttemptAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastError" character varying(512),
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "publishedAt" timestamp(3) without time zone
);


--
-- Name: ModelDuration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ModelDuration" (
    id text NOT NULL,
    "modelId" text NOT NULL,
    label text NOT NULL,
    seconds integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ModelResolution; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ModelResolution" (
    id text NOT NULL,
    "modelId" text NOT NULL,
    label text NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: NodeArtifact; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NodeArtifact" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "nodeId" text NOT NULL,
    "teamId" text NOT NULL,
    role text DEFAULT 'primary'::text NOT NULL,
    "targetField" text NOT NULL,
    "targetItemId" text DEFAULT ''::text NOT NULL,
    "mediaId" text,
    "resultText" text,
    source text DEFAULT 'generated'::text NOT NULL,
    "sourceIntentRowId" text,
    "sourceExecSeq" bigint,
    "artifactIndex" integer DEFAULT 0 NOT NULL,
    state public."ArtifactState" DEFAULT 'none'::public."ArtifactState" NOT NULL,
    rev integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    CONSTRAINT node_artifact_role_domain CHECK ((role = 'primary'::text)),
    CONSTRAINT node_artifact_target_field_domain CHECK (("targetField" = ANY (ARRAY['fileId'::text, 'result'::text])))
);


--
-- Name: NodeExecution; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NodeExecution" (
    "projectId" text NOT NULL,
    "nodeId" text NOT NULL,
    generation integer NOT NULL,
    "execSeq" bigint NOT NULL,
    "nodeVersion" bigint DEFAULT 0 NOT NULL,
    status text NOT NULL,
    attempts integer DEFAULT 1 NOT NULL,
    "errorCode" text,
    "artifactRev" integer,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: NodeLifecycle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NodeLifecycle" (
    "projectId" text NOT NULL,
    "nodeId" text NOT NULL,
    "lifecycleSeq" bigint NOT NULL,
    "isCurrent" boolean DEFAULT true NOT NULL,
    state text NOT NULL,
    "walSeq" bigint NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: NodeType; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NodeType" (
    id text NOT NULL,
    name text NOT NULL,
    key text NOT NULL,
    description text,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ObjectManifest; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ObjectManifest" (
    id text NOT NULL,
    "objectKey" text NOT NULL,
    "sizeBytes" bigint DEFAULT 0 NOT NULL,
    "claimOwner" text,
    "claimUntil" bigint,
    state text DEFAULT 'LIVE'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: PricingRule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PricingRule" (
    id text NOT NULL,
    "nodeTypeId" text NOT NULL,
    "modelId" text,
    "resolutionId" text,
    "durationId" text,
    "creditCost" integer NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    CONSTRAINT pricing_credit_cost_non_negative CHECK (("creditCost" >= 0))
);


--
-- Name: ProjectErasureRun; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ProjectErasureRun" (
    "erasureId" text NOT NULL,
    "scopeType" text NOT NULL,
    "scopeId" text NOT NULL,
    "parentRunId" text,
    "teamId" text,
    state text DEFAULT 'PENDING'::text NOT NULL,
    stage text,
    "dryRun" boolean DEFAULT false NOT NULL,
    "requestedBy" text NOT NULL,
    "requestedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "claimOwner" text,
    "leaseUntil" timestamp(3) without time zone,
    "heartbeatAt" timestamp(3) without time zone,
    "completedAt" timestamp(3) without time zone,
    "manifestPath" text,
    "manifestSha256" character(64),
    error text,
    attempts integer DEFAULT 0 NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ProjectMember; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ProjectMember" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "userId" text NOT NULL,
    role public."ProjectRole" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ProjectionBackfillState; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ProjectionBackfillState" (
    "projectId" text NOT NULL,
    "backfillEpoch" text NOT NULL,
    state text NOT NULL,
    "verifiedSeq" bigint NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL,
    CONSTRAINT "ProjectionBackfillState_state_check" CHECK ((state = ANY (ARRAY['PENDING'::text, 'RUNNING'::text, 'DONE'::text, 'FAILED'::text])))
);


--
-- Name: ReconcileAction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ReconcileAction" (
    id text NOT NULL,
    "intentRowId" text NOT NULL,
    action text NOT NULL,
    before jsonb,
    after jsonb,
    "traceId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: RefundObligation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."RefundObligation" (
    id text NOT NULL,
    "intentRowId" text NOT NULL,
    "execSeq" bigint NOT NULL,
    "reversesId" text NOT NULL,
    "creditAmount" integer NOT NULL,
    state text DEFAULT 'PENDING'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: RuntimeEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."RuntimeEvent" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    generation integer NOT NULL,
    "feedSeq" bigint NOT NULL,
    kind text NOT NULL,
    payload jsonb NOT NULL,
    "docSeq" bigint,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: RuntimeFeedCursor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."RuntimeFeedCursor" (
    "projectId" text NOT NULL,
    "lastSeq" bigint DEFAULT 0 NOT NULL,
    "minRetainedSeq" bigint DEFAULT 0 NOT NULL
);


--
-- Name: Session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Session" (
    id text NOT NULL,
    "userId" text NOT NULL,
    token text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: StorageReservation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."StorageReservation" (
    id text NOT NULL,
    "teamId" text NOT NULL,
    "mediaId" text NOT NULL,
    "upperBoundBytes" bigint NOT NULL,
    state text DEFAULT 'ACTIVE'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Style; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Style" (
    id text NOT NULL,
    name text NOT NULL,
    "categoryId" text NOT NULL,
    "coverKey" text NOT NULL,
    "authorName" text,
    "isCommercial" boolean DEFAULT false NOT NULL,
    "promptText" text NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "usageCount" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: StyleCategory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."StyleCategory" (
    id text NOT NULL,
    name text NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: StyleFavorite; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."StyleFavorite" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "styleId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: StyleRecentUsage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."StyleRecentUsage" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "styleId" text NOT NULL,
    "lastUsedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: SubscriptionOrder; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SubscriptionOrder" (
    id text NOT NULL,
    "orderNo" text NOT NULL,
    "userId" text NOT NULL,
    "planId" text NOT NULL,
    period public."SubscriptionPeriod" NOT NULL,
    type public."SubscriptionOrderType" NOT NULL,
    "originalAmount" integer NOT NULL,
    "payableAmount" integer NOT NULL,
    "prorationAmount" integer,
    "fromSubscriptionId" text,
    "fromPlanId" text,
    status public."SubscriptionOrderStatus" DEFAULT 'PENDING'::public."SubscriptionOrderStatus" NOT NULL,
    "pricingSnapshot" jsonb,
    "payChannel" character varying(32) DEFAULT 'wechat'::character varying NOT NULL,
    "prepayId" character varying(64),
    "transactionId" character varying(64),
    "payerOpenid" character varying(64),
    "paidAt" timestamp(3) without time zone,
    "expiredAt" timestamp(3) without time zone,
    "closedAt" timestamp(3) without time zone,
    "delayCloseJobId" text,
    "notifySummary" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: SubscriptionPlan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SubscriptionPlan" (
    id text NOT NULL,
    name text NOT NULL,
    tier public."SubscriptionTier" NOT NULL,
    "monthlyCredits" integer NOT NULL,
    "storageLimitBytes" bigint NOT NULL,
    "priceMonthly" integer NOT NULL,
    "originalPriceMonthly" integer DEFAULT 0 NOT NULL,
    "priceQuarterly" integer NOT NULL,
    "originalPriceQuarterly" integer DEFAULT 0 NOT NULL,
    "priceAnnually" integer NOT NULL,
    "originalPriceAnnually" integer DEFAULT 0 NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: SystemHistory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SystemHistory" (
    id integer DEFAULT 1 NOT NULL,
    "historyId" text NOT NULL,
    "epochStartedAt" timestamp(3) without time zone NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    CONSTRAINT system_history_single_row_check CHECK ((id = 1))
);


--
-- Name: SystemSetting; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SystemSetting" (
    id text NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Team; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Team" (
    id text NOT NULL,
    name text NOT NULL,
    "ownerId" text NOT NULL,
    status public."TeamStatus" DEFAULT 'ACTIVE'::public."TeamStatus" NOT NULL,
    "joinApproval" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "isDefault" boolean DEFAULT false NOT NULL
);


--
-- Name: TeamBalance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TeamBalance" (
    id text NOT NULL,
    "teamId" text NOT NULL,
    credits integer DEFAULT 0 NOT NULL,
    "subscriptionCredits" integer DEFAULT 0 NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    CONSTRAINT balance_non_negative CHECK (((credits >= 0) AND ("subscriptionCredits" >= 0)))
);


--
-- Name: TeamCreditTransaction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TeamCreditTransaction" (
    id text NOT NULL,
    "teamId" text NOT NULL,
    "operatorUserId" text,
    amount integer NOT NULL,
    type public."TeamCreditTransactionType" NOT NULL,
    "creditType" public."CreditType" NOT NULL,
    "referenceId" text,
    "balanceAfter" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "balanceDelta" integer NOT NULL,
    "frozenDelta" integer NOT NULL,
    "reversesId" text,
    seq bigint NOT NULL,
    "idempotencyKey" text,
    CONSTRAINT ledger_amount_derived CHECK ((amount =
CASE
    WHEN ("balanceDelta" <> 0) THEN "balanceDelta"
    ELSE "frozenDelta"
END)),
    CONSTRAINT money_in_reference_required CHECK (((type <> ALL (ARRAY['recharge'::public."TeamCreditTransactionType", 'subscription_grant'::public."TeamCreditTransactionType", 'expire_clear'::public."TeamCreditTransactionType", 'register_grant'::public."TeamCreditTransactionType"])) OR ("referenceId" IS NOT NULL)))
);


--
-- Name: TeamCreditTransaction_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."TeamCreditTransaction_seq_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: TeamCreditTransaction_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."TeamCreditTransaction_seq_seq" OWNED BY public."TeamCreditTransaction".seq;


--
-- Name: TeamJoinRequest; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TeamJoinRequest" (
    id text NOT NULL,
    "teamId" text NOT NULL,
    "userId" text NOT NULL,
    status public."JoinRequestStatus" DEFAULT 'PENDING'::public."JoinRequestStatus" NOT NULL,
    message text,
    "decidedAt" timestamp(3) without time zone,
    "decidedBy" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TeamMember; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TeamMember" (
    id text NOT NULL,
    "teamId" text NOT NULL,
    "userId" text NOT NULL,
    role public."TeamRole" DEFAULT 'MEMBER'::public."TeamRole" NOT NULL,
    "monthlyQuota" integer DEFAULT 0 NOT NULL,
    "joinedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TeamPlan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TeamPlan" (
    id text NOT NULL,
    name text NOT NULL,
    "monthlyCredits" integer NOT NULL,
    "storageLimitBytes" bigint NOT NULL,
    "seatLimit" integer NOT NULL,
    "priceMonthly" integer NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: TeamRechargeOrder; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TeamRechargeOrder" (
    id text NOT NULL,
    "outTradeNo" text NOT NULL,
    "teamId" text NOT NULL,
    "payerUserId" text NOT NULL,
    "amountFen" integer NOT NULL,
    credits integer NOT NULL,
    kind public."RechargeKind" DEFAULT 'credits'::public."RechargeKind" NOT NULL,
    "planId" text,
    status public."TeamOrderStatus" DEFAULT 'PENDING'::public."TeamOrderStatus" NOT NULL,
    "prepayId" character varying(64),
    "transactionId" character varying(64),
    "payerOpenid" character varying(64),
    "paidAt" timestamp(3) without time zone,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: TeamSubscription; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TeamSubscription" (
    id text NOT NULL,
    "teamId" text NOT NULL,
    "planId" text NOT NULL,
    status public."TeamSubscriptionStatus" DEFAULT 'active'::public."TeamSubscriptionStatus" NOT NULL,
    "paidAmount" integer NOT NULL,
    "currentPeriodStart" timestamp(3) without time zone NOT NULL,
    "currentPeriodEnd" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Template; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Template" (
    id text NOT NULL,
    name text NOT NULL,
    "folderId" text,
    "projectId" text,
    "userId" text NOT NULL,
    "teamId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: User; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."User" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    "emailVerified" boolean NOT NULL,
    role public."Role" DEFAULT 'USER'::public."Role" NOT NULL,
    image text,
    "phoneNumber" character varying(20),
    "phoneNumberVerified" boolean DEFAULT false NOT NULL,
    "wechatOpenid" character varying(64),
    "wechatUnionid" character varying(64),
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: UserSubscription; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."UserSubscription" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "planId" text NOT NULL,
    tier public."SubscriptionTier" NOT NULL,
    period public."SubscriptionPeriod" NOT NULL,
    status public."SubscriptionStatus" DEFAULT 'active'::public."SubscriptionStatus" NOT NULL,
    "paidAmount" integer NOT NULL,
    "totalCredits" integer NOT NULL,
    "totalDays" integer NOT NULL,
    "consumedCredits" integer DEFAULT 0 NOT NULL,
    "subscribedAt" timestamp(3) without time zone NOT NULL,
    "currentPeriodStart" timestamp(3) without time zone NOT NULL,
    "currentPeriodEnd" timestamp(3) without time zone NOT NULL,
    "nextGrantDate" timestamp(3) without time zone NOT NULL,
    "grantCount" integer DEFAULT 1 NOT NULL,
    "previousSubId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Verification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Verification" (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: VideoCategory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VideoCategory" (
    id text NOT NULL,
    name character varying(64) NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: VideoProject; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VideoProject" (
    id text NOT NULL,
    "teamId" text NOT NULL,
    "userId" text NOT NULL,
    "workflowId" text NOT NULL,
    "sourceNodeId" text NOT NULL,
    title text NOT NULL,
    data jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: VideoSeparateTask; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VideoSeparateTask" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "workflowId" text NOT NULL,
    "nodeId" text NOT NULL,
    "sourceFileId" text NOT NULL,
    mode text DEFAULT 'split'::text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    "videoFileId" text,
    "audioFileId" text,
    "errorMsg" text,
    "errorType" text,
    "teamId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "finishedAt" timestamp(3) without time zone
);


--
-- Name: VideoTag; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VideoTag" (
    id text NOT NULL,
    name character varying(32) NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: VideoTrimTask; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VideoTrimTask" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "workflowId" text NOT NULL,
    "nodeId" text NOT NULL,
    "sourceFileId" text NOT NULL,
    "startTime" double precision NOT NULL,
    "endTime" double precision NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    "outputFileId" text,
    "errorMsg" text,
    "teamId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "finishedAt" timestamp(3) without time zone
);


--
-- Name: VideoWork; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VideoWork" (
    id text NOT NULL,
    title character varying(200) NOT NULL,
    description text,
    "authorName" character varying(64) NOT NULL,
    "categoryId" text,
    "videoKey" character varying(512) NOT NULL,
    "videoMediaId" text,
    "coverKey" character varying(512),
    "canvasProjectId" text,
    "durationSec" integer,
    width integer,
    height integer,
    "viewCount" integer DEFAULT 0 NOT NULL,
    "likeCount" integer DEFAULT 0 NOT NULL,
    tags text[] DEFAULT ARRAY[]::text[],
    "sortOrder" integer DEFAULT 0 NOT NULL,
    status public."VideoWorkStatus" DEFAULT 'DRAFT'::public."VideoWorkStatus" NOT NULL,
    "allowViewProcess" boolean DEFAULT false NOT NULL,
    "allowClone" boolean DEFAULT false NOT NULL,
    "publishedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: VideoWorkSetting; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VideoWorkSetting" (
    id text DEFAULT 'singleton'::text NOT NULL,
    "carouselEnabled" boolean DEFAULT true NOT NULL,
    "carouselScope" text DEFAULT 'all'::text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Name: exec_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.exec_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: subscription_banner; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_banner (
    id text DEFAULT 'subscription-banner-singleton'::text NOT NULL,
    title character varying(64) NOT NULL,
    subtitle character varying(200) NOT NULL,
    "backgroundImageUrl" character varying(500),
    "backgroundImageKey" character varying(255),
    "countdownEndAt" timestamp(3) without time zone,
    "autoExtend" boolean DEFAULT false NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: TeamCreditTransaction seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamCreditTransaction" ALTER COLUMN seq SET DEFAULT nextval('public."TeamCreditTransaction_seq_seq"'::regclass);


--
-- Name: AIModel AIModel_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AIModel"
    ADD CONSTRAINT "AIModel_pkey" PRIMARY KEY (id);


--
-- Name: Account Account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Account"
    ADD CONSTRAINT "Account_pkey" PRIMARY KEY (id);


--
-- Name: Announcement Announcement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Announcement"
    ADD CONSTRAINT "Announcement_pkey" PRIMARY KEY (id);


--
-- Name: ArtifactProjection ArtifactProjection_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArtifactProjection"
    ADD CONSTRAINT "ArtifactProjection_pkey" PRIMARY KEY (id);


--
-- Name: AuditLog AuditLog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuditLog"
    ADD CONSTRAINT "AuditLog_pkey" PRIMARY KEY (id);


--
-- Name: CanaryPin CanaryPin_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CanaryPin"
    ADD CONSTRAINT "CanaryPin_pkey" PRIMARY KEY ("projectId");


--
-- Name: CanvasDocCoalesced CanvasDocCoalesced_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CanvasDocCoalesced"
    ADD CONSTRAINT "CanvasDocCoalesced_pkey" PRIMARY KEY ("projectId", generation, seq);


--
-- Name: CanvasDocSnapshot CanvasDocSnapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CanvasDocSnapshot"
    ADD CONSTRAINT "CanvasDocSnapshot_pkey" PRIMARY KEY ("projectId", generation, "snapshotRev");


--
-- Name: CanvasDocUpdate CanvasDocUpdate_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CanvasDocUpdate"
    ADD CONSTRAINT "CanvasDocUpdate_pkey" PRIMARY KEY ("projectId", generation, seq);


--
-- Name: CanvasDoc CanvasDoc_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CanvasDoc"
    ADD CONSTRAINT "CanvasDoc_pkey" PRIMARY KEY ("projectId");


--
-- Name: CanvasProject CanvasProject_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CanvasProject"
    ADD CONSTRAINT "CanvasProject_pkey" PRIMARY KEY (id);


--
-- Name: CollabCanaryCursor CollabCanaryCursor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CollabCanaryCursor"
    ADD CONSTRAINT "CollabCanaryCursor_pkey" PRIMARY KEY ("projectId");


--
-- Name: CollabJobCursor CollabJobCursor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CollabJobCursor"
    ADD CONSTRAINT "CollabJobCursor_pkey" PRIMARY KEY (job);


--
-- Name: CollabLease CollabLease_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CollabLease"
    ADD CONSTRAINT "CollabLease_pkey" PRIMARY KEY (scope);


--
-- Name: CollabOpsGate CollabOpsGate_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CollabOpsGate"
    ADD CONSTRAINT "CollabOpsGate_pkey" PRIMARY KEY (gate, "projectId");


--
-- Name: ContentCard ContentCard_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ContentCard"
    ADD CONSTRAINT "ContentCard_pkey" PRIMARY KEY (id);


--
-- Name: DeliveryFence DeliveryFence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DeliveryFence"
    ADD CONSTRAINT "DeliveryFence_pkey" PRIMARY KEY ("projectId", "nodeId");


--
-- Name: DocAuditEvent DocAuditEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DocAuditEvent"
    ADD CONSTRAINT "DocAuditEvent_pkey" PRIMARY KEY (id);


--
-- Name: ExecutionInput ExecutionInput_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ExecutionInput"
    ADD CONSTRAINT "ExecutionInput_pkey" PRIMARY KEY ("requestId");


--
-- Name: ExecutionNodePlan ExecutionNodePlan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ExecutionNodePlan"
    ADD CONSTRAINT "ExecutionNodePlan_pkey" PRIMARY KEY ("requestId", "nodeId");


--
-- Name: ExecutionOutbox ExecutionOutbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ExecutionOutbox"
    ADD CONSTRAINT "ExecutionOutbox_pkey" PRIMARY KEY (id);


--
-- Name: ExecutionRequest ExecutionRequest_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ExecutionRequest"
    ADD CONSTRAINT "ExecutionRequest_pkey" PRIMARY KEY (id);


--
-- Name: Folder Folder_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Folder"
    ADD CONSTRAINT "Folder_pkey" PRIMARY KEY (id);


--
-- Name: GenerationIntent GenerationIntent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."GenerationIntent"
    ADD CONSTRAINT "GenerationIntent_pkey" PRIMARY KEY (id);


--
-- Name: HomeBanner HomeBanner_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."HomeBanner"
    ADD CONSTRAINT "HomeBanner_pkey" PRIMARY KEY (id);


--
-- Name: LifecycleObligation LifecycleObligation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LifecycleObligation"
    ADD CONSTRAINT "LifecycleObligation_pkey" PRIMARY KEY (id);


--
-- Name: LightingTask LightingTask_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LightingTask"
    ADD CONSTRAINT "LightingTask_pkey" PRIMARY KEY (id);


--
-- Name: MaintenanceOperation MaintenanceOperation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MaintenanceOperation"
    ADD CONSTRAINT "MaintenanceOperation_pkey" PRIMARY KEY ("maintenanceId");


--
-- Name: MaterialFolder MaterialFolder_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MaterialFolder"
    ADD CONSTRAINT "MaterialFolder_pkey" PRIMARY KEY (id);


--
-- Name: MaterializeRun MaterializeRun_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MaterializeRun"
    ADD CONSTRAINT "MaterializeRun_pkey" PRIMARY KEY (id);


--
-- Name: MediaBinding MediaBinding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MediaBinding"
    ADD CONSTRAINT "MediaBinding_pkey" PRIMARY KEY (id);


--
-- Name: MediaFactOutbox MediaFactOutbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MediaFactOutbox"
    ADD CONSTRAINT "MediaFactOutbox_pkey" PRIMARY KEY (id);


--
-- Name: MediaFact MediaFact_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MediaFact"
    ADD CONSTRAINT "MediaFact_pkey" PRIMARY KEY ("mediaId", "factType");


--
-- Name: Media Media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Media"
    ADD CONSTRAINT "Media_pkey" PRIMARY KEY (id);


--
-- Name: ModelDuration ModelDuration_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ModelDuration"
    ADD CONSTRAINT "ModelDuration_pkey" PRIMARY KEY (id);


--
-- Name: ModelResolution ModelResolution_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ModelResolution"
    ADD CONSTRAINT "ModelResolution_pkey" PRIMARY KEY (id);


--
-- Name: NodeArtifact NodeArtifact_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NodeArtifact"
    ADD CONSTRAINT "NodeArtifact_pkey" PRIMARY KEY (id);


--
-- Name: NodeExecution NodeExecution_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NodeExecution"
    ADD CONSTRAINT "NodeExecution_pkey" PRIMARY KEY ("projectId", "nodeId");


--
-- Name: NodeLifecycle NodeLifecycle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NodeLifecycle"
    ADD CONSTRAINT "NodeLifecycle_pkey" PRIMARY KEY ("projectId", "nodeId", "lifecycleSeq");


--
-- Name: NodeType NodeType_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NodeType"
    ADD CONSTRAINT "NodeType_pkey" PRIMARY KEY (id);


--
-- Name: ObjectManifest ObjectManifest_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ObjectManifest"
    ADD CONSTRAINT "ObjectManifest_pkey" PRIMARY KEY (id);


--
-- Name: PricingRule PricingRule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PricingRule"
    ADD CONSTRAINT "PricingRule_pkey" PRIMARY KEY (id);


--
-- Name: ProjectErasureRun ProjectErasureRun_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProjectErasureRun"
    ADD CONSTRAINT "ProjectErasureRun_pkey" PRIMARY KEY ("erasureId");


--
-- Name: ProjectMember ProjectMember_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProjectMember"
    ADD CONSTRAINT "ProjectMember_pkey" PRIMARY KEY (id);


--
-- Name: ProjectionBackfillState ProjectionBackfillState_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProjectionBackfillState"
    ADD CONSTRAINT "ProjectionBackfillState_pkey" PRIMARY KEY ("projectId");


--
-- Name: ReconcileAction ReconcileAction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ReconcileAction"
    ADD CONSTRAINT "ReconcileAction_pkey" PRIMARY KEY (id);


--
-- Name: RefundObligation RefundObligation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundObligation"
    ADD CONSTRAINT "RefundObligation_pkey" PRIMARY KEY (id);


--
-- Name: RuntimeEvent RuntimeEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RuntimeEvent"
    ADD CONSTRAINT "RuntimeEvent_pkey" PRIMARY KEY (id);


--
-- Name: RuntimeFeedCursor RuntimeFeedCursor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RuntimeFeedCursor"
    ADD CONSTRAINT "RuntimeFeedCursor_pkey" PRIMARY KEY ("projectId");


--
-- Name: Session Session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Session"
    ADD CONSTRAINT "Session_pkey" PRIMARY KEY (id);


--
-- Name: StorageReservation StorageReservation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StorageReservation"
    ADD CONSTRAINT "StorageReservation_pkey" PRIMARY KEY (id);


--
-- Name: StyleCategory StyleCategory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StyleCategory"
    ADD CONSTRAINT "StyleCategory_pkey" PRIMARY KEY (id);


--
-- Name: StyleFavorite StyleFavorite_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StyleFavorite"
    ADD CONSTRAINT "StyleFavorite_pkey" PRIMARY KEY (id);


--
-- Name: StyleRecentUsage StyleRecentUsage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StyleRecentUsage"
    ADD CONSTRAINT "StyleRecentUsage_pkey" PRIMARY KEY (id);


--
-- Name: Style Style_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Style"
    ADD CONSTRAINT "Style_pkey" PRIMARY KEY (id);


--
-- Name: SubscriptionOrder SubscriptionOrder_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SubscriptionOrder"
    ADD CONSTRAINT "SubscriptionOrder_pkey" PRIMARY KEY (id);


--
-- Name: SubscriptionPlan SubscriptionPlan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SubscriptionPlan"
    ADD CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY (id);


--
-- Name: SystemHistory SystemHistory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SystemHistory"
    ADD CONSTRAINT "SystemHistory_pkey" PRIMARY KEY (id);


--
-- Name: SystemSetting SystemSetting_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SystemSetting"
    ADD CONSTRAINT "SystemSetting_pkey" PRIMARY KEY (id);


--
-- Name: TeamBalance TeamBalance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamBalance"
    ADD CONSTRAINT "TeamBalance_pkey" PRIMARY KEY (id);


--
-- Name: TeamCreditTransaction TeamCreditTransaction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamCreditTransaction"
    ADD CONSTRAINT "TeamCreditTransaction_pkey" PRIMARY KEY (id);


--
-- Name: TeamJoinRequest TeamJoinRequest_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamJoinRequest"
    ADD CONSTRAINT "TeamJoinRequest_pkey" PRIMARY KEY (id);


--
-- Name: TeamMember TeamMember_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamMember"
    ADD CONSTRAINT "TeamMember_pkey" PRIMARY KEY (id);


--
-- Name: TeamPlan TeamPlan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamPlan"
    ADD CONSTRAINT "TeamPlan_pkey" PRIMARY KEY (id);


--
-- Name: TeamRechargeOrder TeamRechargeOrder_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamRechargeOrder"
    ADD CONSTRAINT "TeamRechargeOrder_pkey" PRIMARY KEY (id);


--
-- Name: TeamSubscription TeamSubscription_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamSubscription"
    ADD CONSTRAINT "TeamSubscription_pkey" PRIMARY KEY (id);


--
-- Name: Team Team_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Team"
    ADD CONSTRAINT "Team_pkey" PRIMARY KEY (id);


--
-- Name: Template Template_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Template"
    ADD CONSTRAINT "Template_pkey" PRIMARY KEY (id);


--
-- Name: UserSubscription UserSubscription_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UserSubscription"
    ADD CONSTRAINT "UserSubscription_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: Verification Verification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Verification"
    ADD CONSTRAINT "Verification_pkey" PRIMARY KEY (id);


--
-- Name: VideoCategory VideoCategory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VideoCategory"
    ADD CONSTRAINT "VideoCategory_pkey" PRIMARY KEY (id);


--
-- Name: VideoProject VideoProject_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VideoProject"
    ADD CONSTRAINT "VideoProject_pkey" PRIMARY KEY (id);


--
-- Name: VideoSeparateTask VideoSeparateTask_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VideoSeparateTask"
    ADD CONSTRAINT "VideoSeparateTask_pkey" PRIMARY KEY (id);


--
-- Name: VideoTag VideoTag_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VideoTag"
    ADD CONSTRAINT "VideoTag_pkey" PRIMARY KEY (id);


--
-- Name: VideoTrimTask VideoTrimTask_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VideoTrimTask"
    ADD CONSTRAINT "VideoTrimTask_pkey" PRIMARY KEY (id);


--
-- Name: VideoWorkSetting VideoWorkSetting_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VideoWorkSetting"
    ADD CONSTRAINT "VideoWorkSetting_pkey" PRIMARY KEY (id);


--
-- Name: VideoWork VideoWork_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VideoWork"
    ADD CONSTRAINT "VideoWork_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: subscription_banner subscription_banner_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_banner
    ADD CONSTRAINT subscription_banner_pkey PRIMARY KEY (id);


--
-- Name: AIModel_nodeTypeId_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AIModel_nodeTypeId_active_idx" ON public."AIModel" USING btree ("nodeTypeId", active);


--
-- Name: AIModel_nodeTypeId_sortOrder_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AIModel_nodeTypeId_sortOrder_idx" ON public."AIModel" USING btree ("nodeTypeId", "sortOrder");


--
-- Name: Account_providerId_accountId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON public."Account" USING btree ("providerId", "accountId");


--
-- Name: Account_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Account_userId_idx" ON public."Account" USING btree ("userId");


--
-- Name: ArtifactProjection_artifactId_artifactRev_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ArtifactProjection_artifactId_artifactRev_key" ON public."ArtifactProjection" USING btree ("artifactId", "artifactRev");


--
-- Name: ArtifactProjection_artifactId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArtifactProjection_artifactId_idx" ON public."ArtifactProjection" USING btree ("artifactId");


--
-- Name: ArtifactProjection_state_nextAttemptAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArtifactProjection_state_nextAttemptAt_idx" ON public."ArtifactProjection" USING btree (state, "nextAttemptAt");


--
-- Name: AuditLog_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_createdAt_idx" ON public."AuditLog" USING btree ("createdAt");


--
-- Name: AuditLog_operatorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_operatorId_idx" ON public."AuditLog" USING btree ("operatorId");


--
-- Name: AuditLog_targetType_targetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_targetType_targetId_idx" ON public."AuditLog" USING btree ("targetType", "targetId");


--
-- Name: AuditLog_teamId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_teamId_createdAt_idx" ON public."AuditLog" USING btree ("teamId", "createdAt");


--
-- Name: CanvasDocCoalesced_projectId_generation_updateHash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CanvasDocCoalesced_projectId_generation_updateHash_idx" ON public."CanvasDocCoalesced" USING btree ("projectId", generation, "updateHash");


--
-- Name: CanvasDocUpdate_projectId_generation_updateHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "CanvasDocUpdate_projectId_generation_updateHash_key" ON public."CanvasDocUpdate" USING btree ("projectId", generation, "updateHash");


--
-- Name: CanvasProject_lifecycleState_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CanvasProject_lifecycleState_idx" ON public."CanvasProject" USING btree ("lifecycleState");


--
-- Name: CanvasProject_teamId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CanvasProject_teamId_idx" ON public."CanvasProject" USING btree ("teamId");


--
-- Name: CanvasProject_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CanvasProject_userId_idx" ON public."CanvasProject" USING btree ("userId");


--
-- Name: ContentCard_active_sortOrder_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ContentCard_active_sortOrder_idx" ON public."ContentCard" USING btree (active, "sortOrder");


--
-- Name: DocAuditEvent_projectId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DocAuditEvent_projectId_createdAt_idx" ON public."DocAuditEvent" USING btree ("projectId", "createdAt");


--
-- Name: ExecutionInput_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ExecutionInput_expiresAt_idx" ON public."ExecutionInput" USING btree ("expiresAt");


--
-- Name: ExecutionNodePlan_requestId_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ExecutionNodePlan_requestId_order_idx" ON public."ExecutionNodePlan" USING btree ("requestId", "order");


--
-- Name: ExecutionOutbox_projectId_generation_businessKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ExecutionOutbox_projectId_generation_businessKey_key" ON public."ExecutionOutbox" USING btree ("projectId", generation, "businessKey");


--
-- Name: ExecutionOutbox_projectId_state_claimUntilMs_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ExecutionOutbox_projectId_state_claimUntilMs_idx" ON public."ExecutionOutbox" USING btree ("projectId", state, "claimUntilMs");


--
-- Name: ExecutionRequest_projectId_requestId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ExecutionRequest_projectId_requestId_key" ON public."ExecutionRequest" USING btree ("projectId", "requestId");


--
-- Name: ExecutionRequest_projectId_state_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ExecutionRequest_projectId_state_expiresAt_idx" ON public."ExecutionRequest" USING btree ("projectId", state, "expiresAt");


--
-- Name: ExecutionRequest_teamId_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ExecutionRequest_teamId_state_idx" ON public."ExecutionRequest" USING btree ("teamId", state);


--
-- Name: Folder_teamId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Folder_teamId_idx" ON public."Folder" USING btree ("teamId");


--
-- Name: GenerationIntent_execSeq_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "GenerationIntent_execSeq_key" ON public."GenerationIntent" USING btree ("execSeq");


--
-- Name: GenerationIntent_executionRequestId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "GenerationIntent_executionRequestId_idx" ON public."GenerationIntent" USING btree ("executionRequestId");


--
-- Name: GenerationIntent_frozen_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "GenerationIntent_frozen_user_idx" ON public."GenerationIntent" USING btree ("teamId", "userId") WHERE ("reservedCredits" > 0);


--
-- Name: GenerationIntent_idemKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "GenerationIntent_idemKey_key" ON public."GenerationIntent" USING btree ("idemKey");


--
-- Name: GenerationIntent_jobId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "GenerationIntent_jobId_idx" ON public."GenerationIntent" USING btree ("jobId");


--
-- Name: GenerationIntent_projectId_intentId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "GenerationIntent_projectId_intentId_key" ON public."GenerationIntent" USING btree ("projectId", "intentId");


--
-- Name: GenerationIntent_projectId_nodeId_status_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "GenerationIntent_projectId_nodeId_status_createdAt_idx" ON public."GenerationIntent" USING btree ("projectId", "nodeId", status, "createdAt");


--
-- Name: GenerationIntent_projectId_nodeId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "GenerationIntent_projectId_nodeId_status_idx" ON public."GenerationIntent" USING btree ("projectId", "nodeId", status);


--
-- Name: GenerationIntent_providerTaskId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "GenerationIntent_providerTaskId_idx" ON public."GenerationIntent" USING btree ("providerTaskId");


--
-- Name: GenerationIntent_running_deadline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "GenerationIntent_running_deadline_idx" ON public."GenerationIntent" USING btree ("deadlineAt") WHERE (status = 'RUNNING'::public."IntentStatus");


--
-- Name: GenerationIntent_running_heartbeat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "GenerationIntent_running_heartbeat_idx" ON public."GenerationIntent" USING btree ("heartbeatAt") WHERE (status = 'RUNNING'::public."IntentStatus");


--
-- Name: GenerationIntent_status_completedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "GenerationIntent_status_completedAt_idx" ON public."GenerationIntent" USING btree (status, "completedAt");


--
-- Name: GenerationIntent_status_execProjectedExecSeq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "GenerationIntent_status_execProjectedExecSeq_idx" ON public."GenerationIntent" USING btree (status, "execProjectedExecSeq");


--
-- Name: GenerationIntent_teamId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "GenerationIntent_teamId_idx" ON public."GenerationIntent" USING btree ("teamId");


--
-- Name: GenerationIntent_traceId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "GenerationIntent_traceId_idx" ON public."GenerationIntent" USING btree ("traceId");


--
-- Name: HomeBanner_active_sortOrder_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "HomeBanner_active_sortOrder_idx" ON public."HomeBanner" USING btree (active, "sortOrder");


--
-- Name: LifecycleObligation_projectId_nodeId_kind_walSeq_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "LifecycleObligation_projectId_nodeId_kind_walSeq_key" ON public."LifecycleObligation" USING btree ("projectId", "nodeId", kind, "walSeq");


--
-- Name: LifecycleObligation_projectId_state_claimUntilMs_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "LifecycleObligation_projectId_state_claimUntilMs_idx" ON public."LifecycleObligation" USING btree ("projectId", state, "claimUntilMs");


--
-- Name: LightingTask_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "LightingTask_status_idx" ON public."LightingTask" USING btree (status);


--
-- Name: LightingTask_teamId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "LightingTask_teamId_idx" ON public."LightingTask" USING btree ("teamId");


--
-- Name: LightingTask_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "LightingTask_userId_idx" ON public."LightingTask" USING btree ("userId");


--
-- Name: MaintenanceOperation_idempotencyKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "MaintenanceOperation_idempotencyKey_key" ON public."MaintenanceOperation" USING btree ("idempotencyKey");


--
-- Name: MaintenanceOperation_projectId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MaintenanceOperation_projectId_status_idx" ON public."MaintenanceOperation" USING btree ("projectId", status);


--
-- Name: MaterialFolder_teamId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MaterialFolder_teamId_idx" ON public."MaterialFolder" USING btree ("teamId");


--
-- Name: MaterialFolder_userId_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MaterialFolder_userId_deletedAt_idx" ON public."MaterialFolder" USING btree ("userId", "deletedAt");


--
-- Name: MaterialFolder_userId_sortOrder_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MaterialFolder_userId_sortOrder_idx" ON public."MaterialFolder" USING btree ("userId", "sortOrder");


--
-- Name: MaterializeRun_projectId_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MaterializeRun_projectId_state_idx" ON public."MaterializeRun" USING btree ("projectId", state);


--
-- Name: MediaBinding_mediaId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MediaBinding_mediaId_idx" ON public."MediaBinding" USING btree ("mediaId");


--
-- Name: MediaBinding_projectId_nodeId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MediaBinding_projectId_nodeId_idx" ON public."MediaBinding" USING btree ("projectId", "nodeId");


--
-- Name: MediaBinding_projectId_nodeId_role_targetField_targetItemId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "MediaBinding_projectId_nodeId_role_targetField_targetItemId_key" ON public."MediaBinding" USING btree ("projectId", "nodeId", role, "targetField", "targetItemId");


--
-- Name: MediaFactOutbox_mediaId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MediaFactOutbox_mediaId_idx" ON public."MediaFactOutbox" USING btree ("mediaId");


--
-- Name: MediaFactOutbox_mediaId_projectId_factType_factVersion_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "MediaFactOutbox_mediaId_projectId_factType_factVersion_key" ON public."MediaFactOutbox" USING btree ("mediaId", "projectId", "factType", "factVersion");


--
-- Name: MediaFactOutbox_state_nextAttemptAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MediaFactOutbox_state_nextAttemptAt_idx" ON public."MediaFactOutbox" USING btree (state, "nextAttemptAt");


--
-- Name: Media_bucket_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Media_bucket_key_key" ON public."Media" USING btree (bucket, key);


--
-- Name: Media_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Media_expiresAt_idx" ON public."Media" USING btree ("expiresAt");


--
-- Name: Media_nodeId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Media_nodeId_idx" ON public."Media" USING btree ("nodeId");


--
-- Name: Media_probeState_nextProbeAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Media_probeState_nextProbeAt_idx" ON public."Media" USING btree ("probeState", "nextProbeAt");


--
-- Name: Media_projectId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Media_projectId_idx" ON public."Media" USING btree ("projectId");


--
-- Name: Media_sourceRegistrationKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Media_sourceRegistrationKey_key" ON public."Media" USING btree ("sourceRegistrationKey");


--
-- Name: Media_status_nextMaterializeAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Media_status_nextMaterializeAt_idx" ON public."Media" USING btree (status, "nextMaterializeAt");


--
-- Name: Media_status_pendingExpiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Media_status_pendingExpiresAt_idx" ON public."Media" USING btree (status, "pendingExpiresAt");


--
-- Name: Media_taskId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Media_taskId_idx" ON public."Media" USING btree ("taskId");


--
-- Name: Media_teamId_clientUploadId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Media_teamId_clientUploadId_key" ON public."Media" USING btree ("teamId", "clientUploadId");


--
-- Name: Media_teamId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Media_teamId_idx" ON public."Media" USING btree ("teamId");


--
-- Name: Media_type_status_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Media_type_status_deletedAt_idx" ON public."Media" USING btree (type, status, "deletedAt");


--
-- Name: Media_userId_folderId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Media_userId_folderId_createdAt_idx" ON public."Media" USING btree ("userId", "folderId", "createdAt");


--
-- Name: Media_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Media_userId_idx" ON public."Media" USING btree ("userId");


--
-- Name: Media_userId_isFavorite_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Media_userId_isFavorite_idx" ON public."Media" USING btree ("userId", "isFavorite");


--
-- Name: ModelDuration_modelId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ModelDuration_modelId_idx" ON public."ModelDuration" USING btree ("modelId");


--
-- Name: ModelResolution_modelId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ModelResolution_modelId_idx" ON public."ModelResolution" USING btree ("modelId");


--
-- Name: NodeArtifact_mediaId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "NodeArtifact_mediaId_idx" ON public."NodeArtifact" USING btree ("mediaId");


--
-- Name: NodeArtifact_projectId_nodeId_role_targetField_targetItemId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "NodeArtifact_projectId_nodeId_role_targetField_targetItemId_key" ON public."NodeArtifact" USING btree ("projectId", "nodeId", role, "targetField", "targetItemId");


--
-- Name: NodeArtifact_sourceIntentRowId_sourceExecSeq_artifactIndex_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "NodeArtifact_sourceIntentRowId_sourceExecSeq_artifactIndex_key" ON public."NodeArtifact" USING btree ("sourceIntentRowId", "sourceExecSeq", "artifactIndex");


--
-- Name: NodeArtifact_teamId_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "NodeArtifact_teamId_state_idx" ON public."NodeArtifact" USING btree ("teamId", state);


--
-- Name: NodeLifecycle_projectId_nodeId_current_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "NodeLifecycle_projectId_nodeId_current_key" ON public."NodeLifecycle" USING btree ("projectId", "nodeId") WHERE "isCurrent";


--
-- Name: NodeLifecycle_projectId_nodeId_isCurrent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "NodeLifecycle_projectId_nodeId_isCurrent_idx" ON public."NodeLifecycle" USING btree ("projectId", "nodeId", "isCurrent");


--
-- Name: NodeType_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "NodeType_key_key" ON public."NodeType" USING btree (key);


--
-- Name: ObjectManifest_objectKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ObjectManifest_objectKey_key" ON public."ObjectManifest" USING btree ("objectKey");


--
-- Name: ObjectManifest_state_claimUntil_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ObjectManifest_state_claimUntil_idx" ON public."ObjectManifest" USING btree (state, "claimUntil");


--
-- Name: PricingRule_modelId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PricingRule_modelId_idx" ON public."PricingRule" USING btree ("modelId");


--
-- Name: PricingRule_nodeTypeId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PricingRule_nodeTypeId_idx" ON public."PricingRule" USING btree ("nodeTypeId");


--
-- Name: ProjectErasureRun_parentRunId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ProjectErasureRun_parentRunId_idx" ON public."ProjectErasureRun" USING btree ("parentRunId");


--
-- Name: ProjectErasureRun_scopeType_scopeId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ProjectErasureRun_scopeType_scopeId_idx" ON public."ProjectErasureRun" USING btree ("scopeType", "scopeId");


--
-- Name: ProjectErasureRun_state_updatedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ProjectErasureRun_state_updatedAt_idx" ON public."ProjectErasureRun" USING btree (state, "updatedAt");


--
-- Name: ProjectMember_projectId_userId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON public."ProjectMember" USING btree ("projectId", "userId");


--
-- Name: ProjectMember_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ProjectMember_userId_idx" ON public."ProjectMember" USING btree ("userId");


--
-- Name: ReconcileAction_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ReconcileAction_createdAt_idx" ON public."ReconcileAction" USING btree ("createdAt");


--
-- Name: ReconcileAction_intentRowId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ReconcileAction_intentRowId_idx" ON public."ReconcileAction" USING btree ("intentRowId");


--
-- Name: RefundObligation_intentRowId_execSeq_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "RefundObligation_intentRowId_execSeq_key" ON public."RefundObligation" USING btree ("intentRowId", "execSeq");


--
-- Name: RuntimeEvent_projectId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RuntimeEvent_projectId_createdAt_idx" ON public."RuntimeEvent" USING btree ("projectId", "createdAt");


--
-- Name: RuntimeEvent_projectId_feedSeq_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "RuntimeEvent_projectId_feedSeq_key" ON public."RuntimeEvent" USING btree ("projectId", "feedSeq");


--
-- Name: RuntimeEvent_projectId_generation_feedSeq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RuntimeEvent_projectId_generation_feedSeq_idx" ON public."RuntimeEvent" USING btree ("projectId", generation, "feedSeq");


--
-- Name: Session_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Session_token_key" ON public."Session" USING btree (token);


--
-- Name: Session_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Session_userId_idx" ON public."Session" USING btree ("userId");


--
-- Name: StorageReservation_mediaId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "StorageReservation_mediaId_key" ON public."StorageReservation" USING btree ("mediaId");


--
-- Name: StorageReservation_teamId_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "StorageReservation_teamId_state_idx" ON public."StorageReservation" USING btree ("teamId", state);


--
-- Name: StyleCategory_active_sortOrder_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "StyleCategory_active_sortOrder_idx" ON public."StyleCategory" USING btree (active, "sortOrder");


--
-- Name: StyleCategory_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "StyleCategory_name_key" ON public."StyleCategory" USING btree (name);


--
-- Name: StyleFavorite_userId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "StyleFavorite_userId_createdAt_idx" ON public."StyleFavorite" USING btree ("userId", "createdAt");


--
-- Name: StyleFavorite_userId_styleId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "StyleFavorite_userId_styleId_key" ON public."StyleFavorite" USING btree ("userId", "styleId");


--
-- Name: StyleRecentUsage_userId_lastUsedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "StyleRecentUsage_userId_lastUsedAt_idx" ON public."StyleRecentUsage" USING btree ("userId", "lastUsedAt");


--
-- Name: StyleRecentUsage_userId_styleId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "StyleRecentUsage_userId_styleId_key" ON public."StyleRecentUsage" USING btree ("userId", "styleId");


--
-- Name: Style_active_sortOrder_usageCount_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Style_active_sortOrder_usageCount_id_idx" ON public."Style" USING btree (active, "sortOrder", "usageCount" DESC, id);


--
-- Name: Style_categoryId_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Style_categoryId_active_idx" ON public."Style" USING btree ("categoryId", active);


--
-- Name: SubscriptionOrder_orderNo_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SubscriptionOrder_orderNo_key" ON public."SubscriptionOrder" USING btree ("orderNo");


--
-- Name: SubscriptionPlan_isActive_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SubscriptionPlan_isActive_sort_idx" ON public."SubscriptionPlan" USING btree ("isActive", sort);


--
-- Name: SystemSetting_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SystemSetting_key_key" ON public."SystemSetting" USING btree (key);


--
-- Name: TeamBalance_teamId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "TeamBalance_teamId_key" ON public."TeamBalance" USING btree ("teamId");


--
-- Name: TeamCreditTransaction_idempotencyKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "TeamCreditTransaction_idempotencyKey_key" ON public."TeamCreditTransaction" USING btree ("idempotencyKey");


--
-- Name: TeamCreditTransaction_referenceId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TeamCreditTransaction_referenceId_idx" ON public."TeamCreditTransaction" USING btree ("referenceId");


--
-- Name: TeamCreditTransaction_reversesId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "TeamCreditTransaction_reversesId_key" ON public."TeamCreditTransaction" USING btree ("reversesId");


--
-- Name: TeamCreditTransaction_settle_user_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TeamCreditTransaction_settle_user_month_idx" ON public."TeamCreditTransaction" USING btree ("teamId", "operatorUserId", "createdAt") WHERE (type = ANY (ARRAY['settle'::public."TeamCreditTransactionType", 'refund'::public."TeamCreditTransactionType"]));


--
-- Name: TeamCreditTransaction_teamId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TeamCreditTransaction_teamId_createdAt_idx" ON public."TeamCreditTransaction" USING btree ("teamId", "createdAt");


--
-- Name: TeamJoinRequest_teamId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TeamJoinRequest_teamId_status_idx" ON public."TeamJoinRequest" USING btree ("teamId", status);


--
-- Name: TeamJoinRequest_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TeamJoinRequest_userId_idx" ON public."TeamJoinRequest" USING btree ("userId");


--
-- Name: TeamMember_teamId_userId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON public."TeamMember" USING btree ("teamId", "userId");


--
-- Name: TeamMember_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TeamMember_userId_idx" ON public."TeamMember" USING btree ("userId");


--
-- Name: TeamPlan_isActive_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TeamPlan_isActive_sort_idx" ON public."TeamPlan" USING btree ("isActive", sort);


--
-- Name: TeamRechargeOrder_outTradeNo_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "TeamRechargeOrder_outTradeNo_key" ON public."TeamRechargeOrder" USING btree ("outTradeNo");


--
-- Name: TeamRechargeOrder_status_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TeamRechargeOrder_status_expiresAt_idx" ON public."TeamRechargeOrder" USING btree (status, "expiresAt");


--
-- Name: TeamRechargeOrder_teamId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TeamRechargeOrder_teamId_createdAt_idx" ON public."TeamRechargeOrder" USING btree ("teamId", "createdAt");


--
-- Name: TeamSubscription_status_currentPeriodEnd_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TeamSubscription_status_currentPeriodEnd_idx" ON public."TeamSubscription" USING btree (status, "currentPeriodEnd");


--
-- Name: Team_ownerId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Team_ownerId_idx" ON public."Team" USING btree ("ownerId");


--
-- Name: Team_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Team_status_idx" ON public."Team" USING btree (status);


--
-- Name: Template_folderId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Template_folderId_idx" ON public."Template" USING btree ("folderId");


--
-- Name: Template_projectId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Template_projectId_key" ON public."Template" USING btree ("projectId");


--
-- Name: Template_teamId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Template_teamId_idx" ON public."Template" USING btree ("teamId");


--
-- Name: Template_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Template_userId_idx" ON public."Template" USING btree ("userId");


--
-- Name: UserSubscription_planId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "UserSubscription_planId_idx" ON public."UserSubscription" USING btree ("planId");


--
-- Name: UserSubscription_status_currentPeriodEnd_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "UserSubscription_status_currentPeriodEnd_idx" ON public."UserSubscription" USING btree (status, "currentPeriodEnd");


--
-- Name: UserSubscription_status_nextGrantDate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "UserSubscription_status_nextGrantDate_idx" ON public."UserSubscription" USING btree (status, "nextGrantDate");


--
-- Name: UserSubscription_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "UserSubscription_userId_idx" ON public."UserSubscription" USING btree ("userId");


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: User_phoneNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_phoneNumber_key" ON public."User" USING btree ("phoneNumber");


--
-- Name: User_wechatOpenid_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_wechatOpenid_key" ON public."User" USING btree ("wechatOpenid");


--
-- Name: Verification_identifier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Verification_identifier_idx" ON public."Verification" USING btree (identifier);


--
-- Name: VideoCategory_active_sortOrder_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VideoCategory_active_sortOrder_idx" ON public."VideoCategory" USING btree (active, "sortOrder");


--
-- Name: VideoCategory_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "VideoCategory_name_key" ON public."VideoCategory" USING btree (name);


--
-- Name: VideoProject_sourceNodeId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "VideoProject_sourceNodeId_key" ON public."VideoProject" USING btree ("sourceNodeId");


--
-- Name: VideoProject_teamId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VideoProject_teamId_idx" ON public."VideoProject" USING btree ("teamId");


--
-- Name: VideoProject_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VideoProject_userId_idx" ON public."VideoProject" USING btree ("userId");


--
-- Name: VideoProject_workflowId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VideoProject_workflowId_idx" ON public."VideoProject" USING btree ("workflowId");


--
-- Name: VideoSeparateTask_nodeId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VideoSeparateTask_nodeId_idx" ON public."VideoSeparateTask" USING btree ("nodeId");


--
-- Name: VideoSeparateTask_sourceFileId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VideoSeparateTask_sourceFileId_idx" ON public."VideoSeparateTask" USING btree ("sourceFileId");


--
-- Name: VideoSeparateTask_teamId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VideoSeparateTask_teamId_idx" ON public."VideoSeparateTask" USING btree ("teamId");


--
-- Name: VideoSeparateTask_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VideoSeparateTask_userId_idx" ON public."VideoSeparateTask" USING btree ("userId");


--
-- Name: VideoTag_active_sortOrder_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VideoTag_active_sortOrder_idx" ON public."VideoTag" USING btree (active, "sortOrder");


--
-- Name: VideoTag_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "VideoTag_name_key" ON public."VideoTag" USING btree (name);


--
-- Name: VideoTrimTask_nodeId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VideoTrimTask_nodeId_idx" ON public."VideoTrimTask" USING btree ("nodeId");


--
-- Name: VideoTrimTask_teamId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VideoTrimTask_teamId_idx" ON public."VideoTrimTask" USING btree ("teamId");


--
-- Name: VideoTrimTask_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VideoTrimTask_userId_idx" ON public."VideoTrimTask" USING btree ("userId");


--
-- Name: VideoWork_categoryId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VideoWork_categoryId_status_idx" ON public."VideoWork" USING btree ("categoryId", status);


--
-- Name: VideoWork_status_sortOrder_publishedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VideoWork_status_sortOrder_publishedAt_idx" ON public."VideoWork" USING btree (status, "sortOrder", "publishedAt" DESC);


--
-- Name: VideoWork_videoMediaId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VideoWork_videoMediaId_idx" ON public."VideoWork" USING btree ("videoMediaId");


--
-- Name: announcement_single_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX announcement_single_active ON public."Announcement" USING btree (active) WHERE active;


--
-- Name: folder_team_parent_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX folder_team_parent_name_unique ON public."Folder" USING btree ("teamId", "parentId", name) WHERE ("parentId" IS NOT NULL);


--
-- Name: folder_team_root_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX folder_team_root_name_unique ON public."Folder" USING btree ("teamId", name) WHERE ("parentId" IS NULL);


--
-- Name: generation_intent_active_node_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX generation_intent_active_node_unique ON public."GenerationIntent" USING btree ("projectId", "nodeId") WHERE (status = 'RUNNING'::public."IntentStatus");


--
-- Name: generation_intent_frozen_partial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generation_intent_frozen_partial ON public."GenerationIntent" USING btree ("teamId") WHERE ("reservedCredits" > 0);


--
-- Name: ledger_reserve_open_partial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ledger_reserve_open_partial ON public."TeamCreditTransaction" USING btree ("createdAt") WHERE (type = 'reserve'::public."TeamCreditTransactionType");


--
-- Name: maintenance_operation_one_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX maintenance_operation_one_active_idx ON public."MaintenanceOperation" USING btree ("projectId") WHERE (stage <> ALL (ARRAY['COMPLETED'::public."MaintenanceStage", 'FAILED'::public."MaintenanceStage", 'ABORTED'::public."MaintenanceStage"]));


--
-- Name: material_folder_team_parent_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX material_folder_team_parent_name_unique ON public."MaterialFolder" USING btree ("teamId", "parentId", name) WHERE ("parentId" IS NOT NULL);


--
-- Name: material_folder_team_root_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX material_folder_team_root_name_unique ON public."MaterialFolder" USING btree ("teamId", name) WHERE ("parentId" IS NULL);


--
-- Name: money_in_once; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX money_in_once ON public."TeamCreditTransaction" USING btree (type, "referenceId", "creditType") WHERE (type = ANY (ARRAY['recharge'::public."TeamCreditTransactionType", 'subscription_grant'::public."TeamCreditTransactionType", 'expire_clear'::public."TeamCreditTransactionType", 'register_grant'::public."TeamCreditTransactionType"]));


--
-- Name: pricing_rule_natural_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pricing_rule_natural_key ON public."PricingRule" USING btree ("nodeTypeId", "modelId", "resolutionId", "durationId") NULLS NOT DISTINCT;


--
-- Name: project_erasure_active_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX project_erasure_active_uq ON public."ProjectErasureRun" USING btree ("scopeType", "scopeId") WHERE ((state = ANY (ARRAY['PENDING'::text, 'RUNNING'::text, 'DRAINING'::text, 'WAITING_CHILDREN'::text, 'PURGING_DB'::text, 'PURGING_OBJECTS'::text, 'PURGING_CACHE'::text, 'VERIFYING'::text])) AND ("dryRun" = false));


--
-- Name: team_owner_default_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX team_owner_default_unique ON public."Team" USING btree ("ownerId") WHERE ("isDefault" = true);


--
-- Name: team_subscription_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX team_subscription_one_active ON public."TeamSubscription" USING btree ("teamId") WHERE (status = 'active'::public."TeamSubscriptionStatus");


--
-- Name: user_subscription_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_subscription_one_active ON public."UserSubscription" USING btree ("userId") WHERE (status = 'active'::public."SubscriptionStatus");


--
-- Name: TeamBalance team_balance_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER team_balance_guard BEFORE INSERT OR DELETE OR UPDATE ON public."TeamBalance" FOR EACH ROW EXECUTE FUNCTION public.ledger_guard();


--
-- Name: TeamCreditTransaction team_credit_transaction_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER team_credit_transaction_guard BEFORE INSERT OR DELETE OR UPDATE ON public."TeamCreditTransaction" FOR EACH ROW EXECUTE FUNCTION public.ledger_guard();


--
-- Name: AIModel AIModel_nodeTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AIModel"
    ADD CONSTRAINT "AIModel_nodeTypeId_fkey" FOREIGN KEY ("nodeTypeId") REFERENCES public."NodeType"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Account Account_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Account"
    ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CanvasDocSnapshot CanvasDocSnapshot_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CanvasDocSnapshot"
    ADD CONSTRAINT "CanvasDocSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."CanvasProject"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CanvasDocUpdate CanvasDocUpdate_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CanvasDocUpdate"
    ADD CONSTRAINT "CanvasDocUpdate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."CanvasProject"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CanvasDoc CanvasDoc_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CanvasDoc"
    ADD CONSTRAINT "CanvasDoc_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."CanvasProject"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CanvasProject CanvasProject_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CanvasProject"
    ADD CONSTRAINT "CanvasProject_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CanvasProject CanvasProject_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CanvasProject"
    ADD CONSTRAINT "CanvasProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Folder Folder_parentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Folder"
    ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES public."Folder"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Folder Folder_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Folder"
    ADD CONSTRAINT "Folder_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Folder Folder_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Folder"
    ADD CONSTRAINT "Folder_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: GenerationIntent GenerationIntent_pricingRuleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."GenerationIntent"
    ADD CONSTRAINT "GenerationIntent_pricingRuleId_fkey" FOREIGN KEY ("pricingRuleId") REFERENCES public."PricingRule"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: LightingTask LightingTask_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LightingTask"
    ADD CONSTRAINT "LightingTask_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MaterialFolder MaterialFolder_parentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MaterialFolder"
    ADD CONSTRAINT "MaterialFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES public."MaterialFolder"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: MaterialFolder MaterialFolder_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MaterialFolder"
    ADD CONSTRAINT "MaterialFolder_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MaterialFolder MaterialFolder_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MaterialFolder"
    ADD CONSTRAINT "MaterialFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MediaBinding MediaBinding_mediaId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MediaBinding"
    ADD CONSTRAINT "MediaBinding_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES public."Media"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MediaFact MediaFact_mediaId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MediaFact"
    ADD CONSTRAINT "MediaFact_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES public."Media"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Media Media_folderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Media"
    ADD CONSTRAINT "Media_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES public."MaterialFolder"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Media Media_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Media"
    ADD CONSTRAINT "Media_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Media Media_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Media"
    ADD CONSTRAINT "Media_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ModelDuration ModelDuration_modelId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ModelDuration"
    ADD CONSTRAINT "ModelDuration_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES public."AIModel"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ModelResolution ModelResolution_modelId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ModelResolution"
    ADD CONSTRAINT "ModelResolution_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES public."AIModel"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PricingRule PricingRule_durationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PricingRule"
    ADD CONSTRAINT "PricingRule_durationId_fkey" FOREIGN KEY ("durationId") REFERENCES public."ModelDuration"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: PricingRule PricingRule_modelId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PricingRule"
    ADD CONSTRAINT "PricingRule_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES public."AIModel"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PricingRule PricingRule_nodeTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PricingRule"
    ADD CONSTRAINT "PricingRule_nodeTypeId_fkey" FOREIGN KEY ("nodeTypeId") REFERENCES public."NodeType"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PricingRule PricingRule_resolutionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PricingRule"
    ADD CONSTRAINT "PricingRule_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES public."ModelResolution"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ProjectMember ProjectMember_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProjectMember"
    ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."CanvasProject"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectMember ProjectMember_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProjectMember"
    ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Session Session_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Session"
    ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StyleFavorite StyleFavorite_styleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StyleFavorite"
    ADD CONSTRAINT "StyleFavorite_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES public."Style"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StyleFavorite StyleFavorite_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StyleFavorite"
    ADD CONSTRAINT "StyleFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StyleRecentUsage StyleRecentUsage_styleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StyleRecentUsage"
    ADD CONSTRAINT "StyleRecentUsage_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES public."Style"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StyleRecentUsage StyleRecentUsage_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StyleRecentUsage"
    ADD CONSTRAINT "StyleRecentUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Style Style_categoryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Style"
    ADD CONSTRAINT "Style_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES public."StyleCategory"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TeamBalance TeamBalance_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamBalance"
    ADD CONSTRAINT "TeamBalance_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TeamJoinRequest TeamJoinRequest_decidedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamJoinRequest"
    ADD CONSTRAINT "TeamJoinRequest_decidedBy_fkey" FOREIGN KEY ("decidedBy") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: TeamJoinRequest TeamJoinRequest_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamJoinRequest"
    ADD CONSTRAINT "TeamJoinRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TeamJoinRequest TeamJoinRequest_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamJoinRequest"
    ADD CONSTRAINT "TeamJoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TeamMember TeamMember_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamMember"
    ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TeamMember TeamMember_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamMember"
    ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TeamSubscription TeamSubscription_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamSubscription"
    ADD CONSTRAINT "TeamSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES public."TeamPlan"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TeamSubscription TeamSubscription_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamSubscription"
    ADD CONSTRAINT "TeamSubscription_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Team Team_ownerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Team"
    ADD CONSTRAINT "Team_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Template Template_folderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Template"
    ADD CONSTRAINT "Template_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES public."Folder"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Template Template_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Template"
    ADD CONSTRAINT "Template_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."CanvasProject"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Template Template_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Template"
    ADD CONSTRAINT "Template_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Template Template_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Template"
    ADD CONSTRAINT "Template_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: UserSubscription UserSubscription_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UserSubscription"
    ADD CONSTRAINT "UserSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES public."SubscriptionPlan"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: VideoProject VideoProject_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VideoProject"
    ADD CONSTRAINT "VideoProject_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VideoProject VideoProject_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VideoProject"
    ADD CONSTRAINT "VideoProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VideoProject VideoProject_workflowId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VideoProject"
    ADD CONSTRAINT "VideoProject_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES public."CanvasProject"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VideoSeparateTask VideoSeparateTask_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VideoSeparateTask"
    ADD CONSTRAINT "VideoSeparateTask_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VideoTrimTask VideoTrimTask_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VideoTrimTask"
    ADD CONSTRAINT "VideoTrimTask_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VideoWork VideoWork_categoryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VideoWork"
    ADD CONSTRAINT "VideoWork_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES public."VideoCategory"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict bwht96jfvD77xWkMlqB4EFX0mJquZmm9o9HiDEYzK13ykxb85Cckfea3kMbI9ZV

