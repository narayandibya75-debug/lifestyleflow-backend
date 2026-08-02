import fs from "fs";
import path from "path";

const API_KEY = process.env.PIXABAY_API_KEY!;

function chooseBestTrack(
    tracks: any[],
    targetDuration: number
) {

    let best = tracks[0];
    let bestScore = -999999;

    for (const track of tracks) {

        let score = 0;

        //----------------------------------
        // closest duration
        //----------------------------------

        score -= Math.abs(
            track.duration -
            targetDuration
        );

        //----------------------------------
        // popularity
        //----------------------------------

        score += track.downloads * 0.02;
        score += track.likes * 2;

        //----------------------------------
        // avoid vocals
        //----------------------------------

        if (
            track.name
                .toLowerCase()
                .includes("vocal")
        )
            score -= 500;

        //----------------------------------
        // prefer instrumental
        //----------------------------------

        if (
            track.name
                .toLowerCase()
                .includes("instrumental")
        )
            score += 200;

        //----------------------------------

        if (score > bestScore) {
            bestScore = score;
            best = track;
        }
    }

    console.log(
        "Selected:",
        best.name
    );

    return best;
}

export async function downloadBackgroundMusic(folder: string) {

    const content = JSON.parse(
        fs.readFileSync(
            path.join(folder, "content.json"),
            "utf8"
        )
    );

    const music = content.background_music;

    const search = music.search_query;

    console.log("Searching music:", search);

    const url =
        `https://pixabay.com/api/audio/?` +
        `key=${API_KEY}` +
        `&q=${encodeURIComponent(search)}` +
        `&per_page=20`;

    const response = await fetch(url);

    const data = await response.json();

    if (!data.hits?.length) {
        throw new Error("No music found.");
    }

    const durationTarget =
        content.scenes.reduce(
            (sum: number, s: any) => sum + s.duration,
            0
        );

    const best = chooseBestTrack(
        data.hits,
        durationTarget
    );

    const file = await fetch(best.audio);

    const buffer = Buffer.from(
        await file.arrayBuffer()
    );

    const musicFolder = path.join(
        folder,
        "music"
    );

    fs.mkdirSync(musicFolder, {
        recursive: true,
    });

    const output =
        path.join(
            musicFolder,
            "background.mp3"
        );

    fs.writeFileSync(output, buffer);

    console.log("Downloaded:", output);

    return output;
}