# Gemini Video Studio — Complete Render package

This package includes the public HTML frontend and the Node.js backend in one Render web service. Visitors do not enter a backend URL or API key.

## Render configuration
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Environment variable: `GEMINI_API_KEY` = a NEW Gemini API key created in Google AI Studio

Do not put the API key in `public/index.html`, APK assets, GitHub, or this ZIP.

## Deploy
Upload this project to a GitHub repository and connect that repository to your existing Render Web Service, or replace the service source with these files. Set the environment variable in Render and deploy. Open the Render service URL; it serves the app at `/` and health at `/health`.

## API implementation
Uses the Gemini Interactions API and model `gemini-omni-1.2-flash` for video generation. The server starts a job and the browser polls for completion. Generated MP4 files are served from `/generated/`.

## Important
- This package has been syntax-checked, but a live video generation test cannot be performed without a valid, active Gemini API key in your Render environment.
- Google API access, quota, billing, and regional availability must be enabled for the key/project.
- A public app can incur costs on the owner's API account. Add user authentication, per-user quotas, abuse protection, and billing controls before broad public release.
- Render local filesystem storage may be ephemeral on some plans; generated files can be lost on redeploy/restart. For production, use persistent storage or a cloud object store.
