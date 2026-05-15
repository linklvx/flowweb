--
-- PostgreSQL database dump
--

\restrict xUQeMWFViEjOZwDvyE8azAdeEmLQaCUhzMXg4ZxNSnz7CD7RtL8K7ru1DhoSI9r

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

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: AIModel; Type: TABLE; Schema: public; Owner: flowweb
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
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."AIModel" OWNER TO flowweb;

--
-- Name: Account; Type: TABLE; Schema: public; Owner: flowweb
--

CREATE TABLE public."Account" (
    id text NOT NULL,
    "userId" text NOT NULL,
    scope text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "accessToken" text,
    "accessTokenExpiresAt" timestamp(3) without time zone,
    "accountId" text NOT NULL,
    "idToken" text,
    password text,
    "providerId" text NOT NULL,
    "refreshToken" text,
    "refreshTokenExpiresAt" timestamp(3) without time zone
);


ALTER TABLE public."Account" OWNER TO flowweb;

--
-- Name: Announcement; Type: TABLE; Schema: public; Owner: flowweb
--

CREATE TABLE public."Announcement" (
    id text NOT NULL,
    message text NOT NULL,
    "linkUrl" text,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Announcement" OWNER TO flowweb;

--
-- Name: CanvasEdge; Type: TABLE; Schema: public; Owner: flowweb
--

CREATE TABLE public."CanvasEdge" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "sourceId" text NOT NULL,
    "targetId" text NOT NULL
);


ALTER TABLE public."CanvasEdge" OWNER TO flowweb;

--
-- Name: CanvasNode; Type: TABLE; Schema: public; Owner: flowweb
--

CREATE TABLE public."CanvasNode" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    type text NOT NULL,
    "position" jsonb NOT NULL,
    data jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."CanvasNode" OWNER TO flowweb;

--
-- Name: CanvasProject; Type: TABLE; Schema: public; Owner: flowweb
--

CREATE TABLE public."CanvasProject" (
    id text NOT NULL,
    name text NOT NULL,
    viewport jsonb DEFAULT '{"x": 0, "y": 0, "zoom": 1}'::jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."CanvasProject" OWNER TO flowweb;

--
-- Name: ContentCard; Type: TABLE; Schema: public; Owner: flowweb
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


ALTER TABLE public."ContentCard" OWNER TO flowweb;

--
-- Name: ModelDuration; Type: TABLE; Schema: public; Owner: flowweb
--

CREATE TABLE public."ModelDuration" (
    id text NOT NULL,
    "modelId" text NOT NULL,
    label text NOT NULL,
    seconds integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."ModelDuration" OWNER TO flowweb;

--
-- Name: ModelResolution; Type: TABLE; Schema: public; Owner: flowweb
--

CREATE TABLE public."ModelResolution" (
    id text NOT NULL,
    "modelId" text NOT NULL,
    label text NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."ModelResolution" OWNER TO flowweb;

--
-- Name: NodeType; Type: TABLE; Schema: public; Owner: flowweb
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


ALTER TABLE public."NodeType" OWNER TO flowweb;

--
-- Name: PricingRule; Type: TABLE; Schema: public; Owner: flowweb
--

CREATE TABLE public."PricingRule" (
    id text NOT NULL,
    "nodeTypeId" text NOT NULL,
    "modelId" text NOT NULL,
    "resolutionId" text,
    "durationId" text,
    "creditCost" integer NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."PricingRule" OWNER TO flowweb;

--
-- Name: Session; Type: TABLE; Schema: public; Owner: flowweb
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


ALTER TABLE public."Session" OWNER TO flowweb;

--
-- Name: User; Type: TABLE; Schema: public; Owner: flowweb
--

CREATE TABLE public."User" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    "emailVerified" boolean NOT NULL,
    image text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."User" OWNER TO flowweb;

--
-- Name: UserBalance; Type: TABLE; Schema: public; Owner: flowweb
--

CREATE TABLE public."UserBalance" (
    id text NOT NULL,
    "userId" text NOT NULL,
    credits integer DEFAULT 100 NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."UserBalance" OWNER TO flowweb;

--
-- Data for Name: AIModel; Type: TABLE DATA; Schema: public; Owner: flowweb
--

COPY public."AIModel" (id, "nodeTypeId", name, provider, "apiUrl", "apiKey", "sortOrder", recommended, active, "createdAt", "updatedAt") FROM stdin;
seed-model-sdxl	cmp6zsydr0001wf7z9240zzar	Stable Diffusion XL	Stability AI	https://api.stability.ai/v1/generation	\N	1	t	t	2026-05-15 14:08:23.057	2026-05-15 14:08:23.057
seed-model-dalle	cmp6zsydr0001wf7z9240zzar	DALL-E 3	OpenAI	https://api.openai.com/v1/images/generations	\N	2	f	t	2026-05-15 14:08:23.06	2026-05-15 14:08:23.06
seed-model-hy-image	cmp6zsydr0001wf7z9240zzar	HY-Image-V3.0	腾讯混元	https://tokenhub.tencentmaas.com/v1/api/image	sk-3spY8oRUCrMphKWPwS8I8jKxTGH9LyCaDrxfhucZFpi02y2C	0	t	t	2026-05-15 14:08:23.061	2026-05-15 14:08:23.061
seed-model-gpt4	cmp6zsydq0000wf7zy11tdbpe	GPT-4o	OpenAI	https://api.openai.com/v1/chat/completions	\N	1	t	t	2026-05-15 14:08:23.076	2026-05-15 14:08:23.076
seed-model-kimi	cmp6zsydq0000wf7zy11tdbpe	Kimi K2.6	Moonshot AI	https://api.moonshot.cn/v1	\N	2	t	t	2026-05-15 14:08:23.077	2026-05-15 14:08:23.077
seed-model-hy-video	cmp6zsyds0002wf7zt1fcynah	HY-Video 1.5	Tencent Maas	https://tokenhub.tencentmaas.com/v1/api/video	\N	1	t	t	2026-05-15 14:08:23.08	2026-05-15 14:08:23.08
\.


--
-- Data for Name: Account; Type: TABLE DATA; Schema: public; Owner: flowweb
--

COPY public."Account" (id, "userId", scope, "createdAt", "updatedAt", "accessToken", "accessTokenExpiresAt", "accountId", "idToken", password, "providerId", "refreshToken", "refreshTokenExpiresAt") FROM stdin;
ZT1kAxp73Hnvvukn36sjKUxZCXIEXUvb	2SaHkVPlcjepTUBNBsTbtkiF0NUfPMF0	\N	2026-05-15 14:23:00.55	2026-05-15 14:23:00.55	\N	\N	2SaHkVPlcjepTUBNBsTbtkiF0NUfPMF0	\N	cf212de6476c75e72d49a363668f5aaa:f4902f6aa9402e84da818c2cbba5a541c4a870c40d739a56e0783b3962f4971cb6b18390fdf881204e7e32cc3313aa18265ec3e2be8d99d0922278c110e72747	credential	\N	\N
3uf7DniM93ArARhaeXCLdF70v0zLp1XS	EeP9scgx0mOddkuDZwgr7dW6Y07nhSFr	\N	2026-05-15 14:33:24.481	2026-05-15 14:33:24.481	\N	\N	EeP9scgx0mOddkuDZwgr7dW6Y07nhSFr	\N	b34a55ac735a4071a7b453dded7d57cf:c6e11b9d4756ff772e08804de42d94d46647ab4403e9111a55a716a0f7c5bdfc3cc975c69a17f35bf74d6867acbda0ca23c004a136ff989177e9ace59d060e46	credential	\N	\N
\.


--
-- Data for Name: Announcement; Type: TABLE DATA; Schema: public; Owner: flowweb
--

COPY public."Announcement" (id, message, "linkUrl", active, "createdAt", "updatedAt") FROM stdin;
seed-announce-1	🎉 新用户注册即送100积分，限时优惠中！	\N	t	2026-05-15 14:08:23.041	2026-05-15 14:08:23.041
\.


--
-- Data for Name: CanvasEdge; Type: TABLE DATA; Schema: public; Owner: flowweb
--

COPY public."CanvasEdge" (id, "projectId", "sourceId", "targetId") FROM stdin;
\.


--
-- Data for Name: CanvasNode; Type: TABLE DATA; Schema: public; Owner: flowweb
--

COPY public."CanvasNode" (id, "projectId", type, "position", data, "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: CanvasProject; Type: TABLE DATA; Schema: public; Owner: flowweb
--

COPY public."CanvasProject" (id, name, viewport, "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: ContentCard; Type: TABLE DATA; Schema: public; Owner: flowweb
--

COPY public."ContentCard" (id, title, "coverUrl", tags, "desc", "sortOrder", active, "createdAt", "updatedAt") FROM stdin;
seed-card-1	文生图工作流	/card-covers/text-to-image.jpg	{推荐,热门}	输入Prompt快速生成高质量图片	1	t	2026-05-15 14:08:23.046	2026-05-15 14:08:23.046
seed-card-2	文生视频工作流	/card-covers/text-to-video.jpg	{新上线}	文本一键转视频	2	t	2026-05-15 14:08:23.048	2026-05-15 14:08:23.048
seed-card-3	图生图工作流	/card-covers/image-to-image.jpg	{推荐}	风格迁移与图像变换	3	t	2026-05-15 14:08:23.049	2026-05-15 14:08:23.049
seed-card-4	智能文案助手	/card-covers/copywriter.jpg	{}	AI驱动的多平台文案创作	4	t	2026-05-15 14:08:23.05	2026-05-15 14:08:23.05
seed-card-5	AI配音工作流	/card-covers/tts.jpg	{即将上线}	文本转语音与多语种配音	5	t	2026-05-15 14:08:23.051	2026-05-15 14:08:23.051
seed-card-6	视频剪辑工作流	/card-covers/video-edit.jpg	{}	智能视频裁剪与特效添加	6	t	2026-05-15 14:08:23.052	2026-05-15 14:08:23.052
seed-card-7	音乐生成工作流	/card-covers/music.jpg	{Beta}	AI自动作曲与编曲	7	t	2026-05-15 14:08:23.053	2026-05-15 14:08:23.053
seed-card-8	3D模型生成	/card-covers/3d.jpg	{即将上线}	文字描述生成3D模型	8	t	2026-05-15 14:08:23.053	2026-05-15 14:08:23.053
\.


--
-- Data for Name: ModelDuration; Type: TABLE DATA; Schema: public; Owner: flowweb
--

COPY public."ModelDuration" (id, "modelId", label, seconds, "createdAt") FROM stdin;
seed-dur-5	seed-model-hy-video	5秒	5	2026-05-15 14:08:23.081
seed-dur-10	seed-model-hy-video	10秒	10	2026-05-15 14:08:23.083
seed-dur-15	seed-model-hy-video	15秒	15	2026-05-15 14:08:23.084
\.


--
-- Data for Name: ModelResolution; Type: TABLE DATA; Schema: public; Owner: flowweb
--

COPY public."ModelResolution" (id, "modelId", label, width, height, "createdAt") FROM stdin;
seed-res-sdxl-1024	seed-model-sdxl	1024×1024	1024	1024	2026-05-15 14:08:23.062
seed-res-sdxl-2048	seed-model-sdxl	2048×2048	2048	2048	2026-05-15 14:08:23.064
seed-res-dalle-1024	seed-model-dalle	1024×1024	1024	1024	2026-05-15 14:08:23.065
seed-res-dalle-512	seed-model-dalle	512×512	512	512	2026-05-15 14:08:23.065
seed-res-hy-1024	seed-model-hy-image	1024×1024	1024	1024	2026-05-15 14:08:23.066
seed-res-hy-2048	seed-model-hy-image	2048×2048	2048	2048	2026-05-15 14:08:23.067
seed-res-hy-512	seed-model-hy-image	512×512	512	512	2026-05-15 14:08:23.068
\.


--
-- Data for Name: NodeType; Type: TABLE DATA; Schema: public; Owner: flowweb
--

COPY public."NodeType" (id, name, key, description, active, "createdAt", "updatedAt") FROM stdin;
cmp6zsydq0000wf7zy11tdbpe	文本生成	text	文本Prompt输入与优化	t	2026-05-15 14:08:23.054	2026-05-15 14:08:23.054
cmp6zsydr0001wf7z9240zzar	图片生成	image	文生图、图生图	t	2026-05-15 14:08:23.056	2026-05-15 14:08:23.056
cmp6zsyds0002wf7zt1fcynah	视频生成	video	文生视频、图生视频	t	2026-05-15 14:08:23.057	2026-05-15 14:08:23.057
\.


--
-- Data for Name: PricingRule; Type: TABLE DATA; Schema: public; Owner: flowweb
--

COPY public."PricingRule" (id, "nodeTypeId", "modelId", "resolutionId", "durationId", "creditCost", active, "createdAt", "updatedAt") FROM stdin;
cmp6zsye50004wf7zro9irs6d	cmp6zsydr0001wf7z9240zzar	seed-model-sdxl	seed-res-sdxl-1024	\N	3	t	2026-05-15 14:08:23.07	2026-05-15 14:22:27.374
cmp6zsye60006wf7zslw09m65	cmp6zsydr0001wf7z9240zzar	seed-model-sdxl	seed-res-sdxl-2048	\N	6	t	2026-05-15 14:08:23.071	2026-05-15 14:22:27.376
cmp6zsye70008wf7zttiuytxy	cmp6zsydr0001wf7z9240zzar	seed-model-dalle	seed-res-dalle-1024	\N	5	t	2026-05-15 14:08:23.072	2026-05-15 14:22:27.377
cmp6zsye8000awf7z39u7izkl	cmp6zsydr0001wf7z9240zzar	seed-model-dalle	seed-res-dalle-512	\N	2	t	2026-05-15 14:08:23.073	2026-05-15 14:22:27.378
cmp6zsye9000cwf7ztmfjzioz	cmp6zsydr0001wf7z9240zzar	seed-model-hy-image	seed-res-hy-512	\N	3	t	2026-05-15 14:08:23.074	2026-05-15 14:22:27.379
cmp6zsyea000ewf7zxsh38chs	cmp6zsydr0001wf7z9240zzar	seed-model-hy-image	seed-res-hy-1024	\N	5	t	2026-05-15 14:08:23.074	2026-05-15 14:22:27.379
cmp6zsyeb000gwf7z99ioaz92	cmp6zsydr0001wf7z9240zzar	seed-model-hy-image	seed-res-hy-2048	\N	10	t	2026-05-15 14:08:23.075	2026-05-15 14:22:27.38
cmp6zsyef000iwf7zrzw11sh6	cmp6zsydq0000wf7zy11tdbpe	seed-model-gpt4	\N	\N	2	t	2026-05-15 14:08:23.079	2026-05-15 14:22:27.383
cmp6zsyef000kwf7zg49oqzi9	cmp6zsydq0000wf7zy11tdbpe	seed-model-kimi	\N	\N	2	t	2026-05-15 14:08:23.08	2026-05-15 14:22:27.384
cmp6zsyel000mwf7z6b0660gl	cmp6zsyds0002wf7zt1fcynah	seed-model-hy-video	\N	seed-dur-5	10	t	2026-05-15 14:08:23.085	2026-05-15 14:22:27.39
cmp6zsyem000owf7zc8hnvri9	cmp6zsyds0002wf7zt1fcynah	seed-model-hy-video	\N	seed-dur-10	18	t	2026-05-15 14:08:23.086	2026-05-15 14:22:27.391
cmp6zsyem000qwf7zqvgzyczw	cmp6zsyds0002wf7zt1fcynah	seed-model-hy-video	\N	seed-dur-15	25	t	2026-05-15 14:08:23.087	2026-05-15 14:22:27.392
\.


--
-- Data for Name: Session; Type: TABLE DATA; Schema: public; Owner: flowweb
--

COPY public."Session" (id, "userId", token, "expiresAt", "ipAddress", "userAgent", "createdAt", "updatedAt") FROM stdin;
FJfM0tF2ZmvPN4jdeTtDsiZRQTE80xZX	2SaHkVPlcjepTUBNBsTbtkiF0NUfPMF0	7k6tz1cmYHs9GX98sc6GX4ua5UlaJpur	2026-05-22 14:23:00.553			2026-05-15 14:23:00.553	2026-05-15 14:23:00.553
w4tKyuhekUBhvLlmWxYoHBI1PMZaLhkJ	2SaHkVPlcjepTUBNBsTbtkiF0NUfPMF0	8q6kLBWCvy4YpUzfnglkq3cqIDLnhsvE	2026-05-22 14:23:13.8			2026-05-15 14:23:13.8	2026-05-15 14:23:13.8
qd9PCGF2pIh9bcN20N0AUtuAYx46YABa	2SaHkVPlcjepTUBNBsTbtkiF0NUfPMF0	jrU7XqB77iaPXriCKQEcW5AMJoN9eQQS	2026-05-22 14:23:37.702			2026-05-15 14:23:37.702	2026-05-15 14:23:37.702
U1G0fjkdJdKtQR5MWQTgcVZQGgfrOZ5k	2SaHkVPlcjepTUBNBsTbtkiF0NUfPMF0	gUFFdbO6Bvyg1A7L4inv0g6sijosCUnS	2026-05-22 14:24:13.466			2026-05-15 14:24:13.466	2026-05-15 14:24:13.466
CDWz32RF7f8lwlXPq2pZxYuEvQCyI6PH	2SaHkVPlcjepTUBNBsTbtkiF0NUfPMF0	yY6kjxqwHrrzU2g5so4kQY44pNCXiKyZ	2026-05-22 14:25:36.408			2026-05-15 14:25:36.408	2026-05-15 14:25:36.408
i02BdyEHdfxPNBFNbEiSWLZeBeYxXUXz	2SaHkVPlcjepTUBNBsTbtkiF0NUfPMF0	nSql9Qkqx47G244Eot9v8MhODoFFJIeI	2026-05-22 14:27:01.983			2026-05-15 14:27:01.984	2026-05-15 14:27:01.984
DcTrYXpkceYPdQ6LQf22rKoFypElxc3m	2SaHkVPlcjepTUBNBsTbtkiF0NUfPMF0	MGzNIY0gRRkLzEObhcZjgSyK3lm8HVMW	2026-05-22 14:28:08.047			2026-05-15 14:28:08.047	2026-05-15 14:28:08.047
wJn55kh60SjKHAgt8GDH992XyFPcefWG	EeP9scgx0mOddkuDZwgr7dW6Y07nhSFr	1f5Otx4NsScLVuw0L1QsrZ8HqNVttzaf	2026-05-22 14:33:24.483			2026-05-15 14:33:24.483	2026-05-15 14:33:24.483
8lJgSoiKOouEzTkB3az4HcCqBq39Nz9K	EeP9scgx0mOddkuDZwgr7dW6Y07nhSFr	bxksaBy4Pr3XfgyjWEJQShKqtMlLKJm2	2026-05-22 14:33:35.777			2026-05-15 14:33:35.777	2026-05-15 14:33:35.777
Iyt7PVSe7d2RYVl5k54cazLpnaBDbQPX	EeP9scgx0mOddkuDZwgr7dW6Y07nhSFr	9Mh3CP7M7rYAJSWoKVt6fZJIqtNVdCuz	2026-05-22 14:46:29.339			2026-05-15 14:46:29.339	2026-05-15 14:46:29.339
m8cHo7pvdznYSI60texUOW76BAvi2lns	EeP9scgx0mOddkuDZwgr7dW6Y07nhSFr	gXXi01yLOuyaGDnKDhaUVVoz9acbhsli	2026-05-22 14:46:43.016			2026-05-15 14:46:43.016	2026-05-15 14:46:43.016
R03gKnKTDugNPcyIVAoaWwbtLm4K8dA1	EeP9scgx0mOddkuDZwgr7dW6Y07nhSFr	Dx8vhAfAfvrpJLtrw37g10e9Z7ZINgJS	2026-05-22 14:48:16.459			2026-05-15 14:48:16.459	2026-05-15 14:48:16.459
01jPTRd0Vw4H8FoVPVqEvDggYQzFcuGo	EeP9scgx0mOddkuDZwgr7dW6Y07nhSFr	XAZ7CJ1ET2IuM1CfaFWsStGOCeB5FC0s	2026-05-22 14:54:31.054			2026-05-15 14:54:31.054	2026-05-15 14:54:31.054
H07c62pk1Ph05uE2rd8mMKLMyPXJ630e	2SaHkVPlcjepTUBNBsTbtkiF0NUfPMF0	QBMFZhY7VLRUaxOWUjB0iHco0IrFVdF4	2026-05-22 15:01:37.285			2026-05-15 15:01:37.285	2026-05-15 15:01:37.285
4TOBu2Q4H6kCmlGu00R8HGPW1AurWb9A	2SaHkVPlcjepTUBNBsTbtkiF0NUfPMF0	BKhvoF9hwENpSi61xda2sKeHfZSGrDic	2026-05-22 15:02:26.455			2026-05-15 15:02:26.455	2026-05-15 15:02:26.455
BlU1EAxbhgvvsRr8ECA35ffqVi4m8Pi5	2SaHkVPlcjepTUBNBsTbtkiF0NUfPMF0	pcyNfwR7WOWBgFHHqHo5uZjGDkEvOl7h	2026-05-22 15:04:16.092			2026-05-15 15:04:16.093	2026-05-15 15:04:16.093
\.


--
-- Data for Name: User; Type: TABLE DATA; Schema: public; Owner: flowweb
--

COPY public."User" (id, name, email, "emailVerified", image, "createdAt", "updatedAt") FROM stdin;
default-user	Default User	default@flowweb.local	t	\N	2026-05-15 14:22:27.392	2026-05-15 14:22:27.392
2SaHkVPlcjepTUBNBsTbtkiF0NUfPMF0	U1	u1@flowai.dev	f	\N	2026-05-15 14:23:00.547	2026-05-15 14:23:00.547
EeP9scgx0mOddkuDZwgr7dW6Y07nhSFr	haixin3036	15153025659@163.com	f	\N	2026-05-15 14:33:24.479	2026-05-15 14:33:24.479
\.


--
-- Data for Name: UserBalance; Type: TABLE DATA; Schema: public; Owner: flowweb
--

COPY public."UserBalance" (id, "userId", credits, version, "createdAt", "updatedAt") FROM stdin;
cmp70b1vm0004yqb90j4w9rcg	default-user	100	0	2026-05-15 14:22:27.394	2026-05-15 14:22:27.394
\.


--
-- Name: AIModel AIModel_pkey; Type: CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."AIModel"
    ADD CONSTRAINT "AIModel_pkey" PRIMARY KEY (id);


--
-- Name: Account Account_pkey; Type: CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."Account"
    ADD CONSTRAINT "Account_pkey" PRIMARY KEY (id);


--
-- Name: Announcement Announcement_pkey; Type: CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."Announcement"
    ADD CONSTRAINT "Announcement_pkey" PRIMARY KEY (id);


--
-- Name: CanvasEdge CanvasEdge_pkey; Type: CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."CanvasEdge"
    ADD CONSTRAINT "CanvasEdge_pkey" PRIMARY KEY (id);


--
-- Name: CanvasNode CanvasNode_pkey; Type: CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."CanvasNode"
    ADD CONSTRAINT "CanvasNode_pkey" PRIMARY KEY (id);


--
-- Name: CanvasProject CanvasProject_pkey; Type: CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."CanvasProject"
    ADD CONSTRAINT "CanvasProject_pkey" PRIMARY KEY (id);


--
-- Name: ContentCard ContentCard_pkey; Type: CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."ContentCard"
    ADD CONSTRAINT "ContentCard_pkey" PRIMARY KEY (id);


--
-- Name: ModelDuration ModelDuration_pkey; Type: CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."ModelDuration"
    ADD CONSTRAINT "ModelDuration_pkey" PRIMARY KEY (id);


--
-- Name: ModelResolution ModelResolution_pkey; Type: CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."ModelResolution"
    ADD CONSTRAINT "ModelResolution_pkey" PRIMARY KEY (id);


--
-- Name: NodeType NodeType_pkey; Type: CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."NodeType"
    ADD CONSTRAINT "NodeType_pkey" PRIMARY KEY (id);


--
-- Name: PricingRule PricingRule_pkey; Type: CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."PricingRule"
    ADD CONSTRAINT "PricingRule_pkey" PRIMARY KEY (id);


--
-- Name: Session Session_pkey; Type: CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."Session"
    ADD CONSTRAINT "Session_pkey" PRIMARY KEY (id);


--
-- Name: UserBalance UserBalance_pkey; Type: CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."UserBalance"
    ADD CONSTRAINT "UserBalance_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: AIModel_nodeTypeId_active_idx; Type: INDEX; Schema: public; Owner: flowweb
--

CREATE INDEX "AIModel_nodeTypeId_active_idx" ON public."AIModel" USING btree ("nodeTypeId", active);


--
-- Name: AIModel_nodeTypeId_sortOrder_idx; Type: INDEX; Schema: public; Owner: flowweb
--

CREATE INDEX "AIModel_nodeTypeId_sortOrder_idx" ON public."AIModel" USING btree ("nodeTypeId", "sortOrder");


--
-- Name: Account_providerId_accountId_key; Type: INDEX; Schema: public; Owner: flowweb
--

CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON public."Account" USING btree ("providerId", "accountId");


--
-- Name: Account_userId_idx; Type: INDEX; Schema: public; Owner: flowweb
--

CREATE INDEX "Account_userId_idx" ON public."Account" USING btree ("userId");


--
-- Name: Announcement_active_idx; Type: INDEX; Schema: public; Owner: flowweb
--

CREATE INDEX "Announcement_active_idx" ON public."Announcement" USING btree (active);


--
-- Name: CanvasEdge_projectId_idx; Type: INDEX; Schema: public; Owner: flowweb
--

CREATE INDEX "CanvasEdge_projectId_idx" ON public."CanvasEdge" USING btree ("projectId");


--
-- Name: CanvasNode_projectId_idx; Type: INDEX; Schema: public; Owner: flowweb
--

CREATE INDEX "CanvasNode_projectId_idx" ON public."CanvasNode" USING btree ("projectId");


--
-- Name: ContentCard_active_sortOrder_idx; Type: INDEX; Schema: public; Owner: flowweb
--

CREATE INDEX "ContentCard_active_sortOrder_idx" ON public."ContentCard" USING btree (active, "sortOrder");


--
-- Name: ModelDuration_modelId_idx; Type: INDEX; Schema: public; Owner: flowweb
--

CREATE INDEX "ModelDuration_modelId_idx" ON public."ModelDuration" USING btree ("modelId");


--
-- Name: ModelResolution_modelId_idx; Type: INDEX; Schema: public; Owner: flowweb
--

CREATE INDEX "ModelResolution_modelId_idx" ON public."ModelResolution" USING btree ("modelId");


--
-- Name: NodeType_key_key; Type: INDEX; Schema: public; Owner: flowweb
--

CREATE UNIQUE INDEX "NodeType_key_key" ON public."NodeType" USING btree (key);


--
-- Name: PricingRule_modelId_idx; Type: INDEX; Schema: public; Owner: flowweb
--

CREATE INDEX "PricingRule_modelId_idx" ON public."PricingRule" USING btree ("modelId");


--
-- Name: PricingRule_nodeTypeId_idx; Type: INDEX; Schema: public; Owner: flowweb
--

CREATE INDEX "PricingRule_nodeTypeId_idx" ON public."PricingRule" USING btree ("nodeTypeId");


--
-- Name: PricingRule_nodeTypeId_modelId_resolutionId_durationId_key; Type: INDEX; Schema: public; Owner: flowweb
--

CREATE UNIQUE INDEX "PricingRule_nodeTypeId_modelId_resolutionId_durationId_key" ON public."PricingRule" USING btree ("nodeTypeId", "modelId", "resolutionId", "durationId");


--
-- Name: Session_token_key; Type: INDEX; Schema: public; Owner: flowweb
--

CREATE UNIQUE INDEX "Session_token_key" ON public."Session" USING btree (token);


--
-- Name: Session_userId_idx; Type: INDEX; Schema: public; Owner: flowweb
--

CREATE INDEX "Session_userId_idx" ON public."Session" USING btree ("userId");


--
-- Name: UserBalance_userId_key; Type: INDEX; Schema: public; Owner: flowweb
--

CREATE UNIQUE INDEX "UserBalance_userId_key" ON public."UserBalance" USING btree ("userId");


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: flowweb
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: AIModel AIModel_nodeTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."AIModel"
    ADD CONSTRAINT "AIModel_nodeTypeId_fkey" FOREIGN KEY ("nodeTypeId") REFERENCES public."NodeType"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Account Account_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."Account"
    ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CanvasEdge CanvasEdge_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."CanvasEdge"
    ADD CONSTRAINT "CanvasEdge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."CanvasProject"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CanvasNode CanvasNode_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."CanvasNode"
    ADD CONSTRAINT "CanvasNode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."CanvasProject"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ModelDuration ModelDuration_modelId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."ModelDuration"
    ADD CONSTRAINT "ModelDuration_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES public."AIModel"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ModelResolution ModelResolution_modelId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."ModelResolution"
    ADD CONSTRAINT "ModelResolution_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES public."AIModel"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PricingRule PricingRule_durationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."PricingRule"
    ADD CONSTRAINT "PricingRule_durationId_fkey" FOREIGN KEY ("durationId") REFERENCES public."ModelDuration"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: PricingRule PricingRule_modelId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."PricingRule"
    ADD CONSTRAINT "PricingRule_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES public."AIModel"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PricingRule PricingRule_nodeTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."PricingRule"
    ADD CONSTRAINT "PricingRule_nodeTypeId_fkey" FOREIGN KEY ("nodeTypeId") REFERENCES public."NodeType"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PricingRule PricingRule_resolutionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."PricingRule"
    ADD CONSTRAINT "PricingRule_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES public."ModelResolution"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Session Session_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."Session"
    ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: UserBalance UserBalance_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: flowweb
--

ALTER TABLE ONLY public."UserBalance"
    ADD CONSTRAINT "UserBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT ALL ON SCHEMA public TO flowweb;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO flowweb;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO flowweb;


--
-- PostgreSQL database dump complete
--

\unrestrict xUQeMWFViEjOZwDvyE8azAdeEmLQaCUhzMXg4ZxNSnz7CD7RtL8K7ru1DhoSI9r

