# Gemini Video Studio Backend

এটি Render-এ চালানোর জন্য Node.js backend starter। `npm start` দিয়ে চালু হবে।

## Render সেটিংস
- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`

## গুরুত্বপূর্ণ সীমাবদ্ধতা
এই ZIP-এ কোনো AI provider-এর API key নেই এবং provider নির্বাচন/সংযোগও করা নেই। তাই Deploy করলে Backend-এর নিজস্ব URL ও `/health` কাজ করবে, কিন্তু ভিডিও তৈরি করার অনুরোধে 503 error আসবে—এটি ইচ্ছাকৃত; ভুয়া ভিডিও বা ভুয়া URL দেখানো হয় না।

## AI provider যুক্ত করার আগে
Render Dashboard → Service → Environment-এ Provider-এর অফিসিয়াল API-র তথ্য বসাতে হবে:
- `VIDEO_API_URL`: provider-এর create-video HTTPS endpoint
- `VIDEO_API_KEY`: provider-এর API key (গোপন রাখুন)
- `VIDEO_STATUS_URL`: provider asynchronous job status endpoint (যদি provider jobId ফেরত দেয়)
- `APP_ORIGIN`: frontend-এর HTTPS origin

Provider create endpoint-কে এই JSON fields বুঝতে হবে: `prompt`, `style`, `duration`, `aspectRatio`, `resolution`, `language`, `cameraMovement`, `lighting`, `backgroundMusic`, `quality`, `negativePrompt`।
সফল হলে সরাসরি `{ "videoUrl": "https://..." }` অথবা `{ "jobId": "...", "statusUrl": "https://..." }` ফেরত দিতে হবে। Status endpoint `{ "status": "processing" }`, `{ "status": "failed", "error": "..." }` অথবা `{ "videoUrl": "https://..." }` ফেরত দেবে।

এই চুক্তির সঙ্গে Provider API না মিললে আলাদা adapter কোড লাগবে। Gemini API-র বর্তমান মডেল/endpoint ও অ্যাকাউন্ট-অ্যাক্সেস যাচাই না করে অনুমান করে API URL বসাবেন না।
