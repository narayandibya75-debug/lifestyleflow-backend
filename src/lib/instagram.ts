import axios from "axios";

const GRAPH_URL = "https://graph.facebook.com/v23.0";

const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN!;
const IG_USER_ID = process.env.INSTAGRAM_BUSINESS_ID!;

if (!ACCESS_TOKEN) {
  throw new Error("Missing INSTAGRAM_ACCESS_TOKEN");
}

if (!IG_USER_ID) {
  throw new Error("Missing INSTAGRAM_BUSINESS_ID");
}

const api = axios.create({
  baseURL: GRAPH_URL,
  timeout: 30000,
});

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function createReelContainer(
  videoUrl: string,
  caption: string
): Promise<string> {

  console.log("Creating Instagram Reel container...");

  const { data } = await api.post(
    `/${IG_USER_ID}/media`,
    null,
    {
      params: {
        media_type: "REELS",
        video_url: videoUrl,
        caption,
        access_token: ACCESS_TOKEN,
      },
    }
  );

  if (!data?.id) {
    throw new Error("Instagram did not return a creation ID.");
  }

  console.log("Container Created:", data.id);

  return data.id;
}

export async function getContainerStatus(
  creationId: string
): Promise<string> {

  const { data } = await api.get(
    `/${creationId}`,
    {
      params: {
        fields: "status_code",
        access_token: ACCESS_TOKEN,
      },
    }
  );

  return data.status_code;
}

export async function waitForContainerReady(
  creationId: string,
  timeout = 300000
) {

  const started = Date.now();

  while (true) {

    const status = await getContainerStatus(
      creationId
    );

    console.log(
      "Instagram Processing:",
      status
    );

    if (status === "FINISHED") {
      return;
    }

    if (
      status === "ERROR" ||
      status === "EXPIRED"
    ) {
      throw new Error(
        `Instagram processing failed (${status})`
      );
    }

    if (
      Date.now() - started >
      timeout
    ) {
      throw new Error(
        "Instagram processing timeout."
      );
    }

    await sleep(5000);
  }
}

export async function publishReel(
  creationId: string
): Promise<string> {

  console.log("Publishing Reel...");

  const { data } = await api.post(
    `/${IG_USER_ID}/media_publish`,
    null,
    {
      params: {
        creation_id: creationId,
        access_token: ACCESS_TOKEN,
      },
    }
  );

  if (!data?.id) {
    throw new Error(
      "Instagram publish failed."
    );
  }

  console.log(
    "Published Media:",
    data.id
  );

  return data.id;
}

export async function getMedia(
  mediaId: string
) {

  const { data } = await api.get(
    `/${mediaId}`,
    {
      params: {
        fields: "id,permalink",
        access_token: ACCESS_TOKEN,
      },
    }
  );

  return data;
}