import React from "react";
import { Composition } from "remotion";
import { NewsVideo, calculateNewsVideoMetadata, newsVideoPropsSchema } from "./compositions/NewsVideo";
import { sampleJobProps } from "../sample-job/sample-job";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="NewsVideo"
        component={NewsVideo}
        // Placeholder values — calculateMetadata overrides all of these from
        // the actual job's props (segment timing, resolution, fps) before render.
        durationInFrames={300}
        fps={30}
        width={3840}
        height={2160}
        schema={newsVideoPropsSchema}
        defaultProps={sampleJobProps}
        calculateMetadata={calculateNewsVideoMetadata}
      />
    </>
  );
};
