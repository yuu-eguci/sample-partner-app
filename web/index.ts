import { createApp } from "./app.ts";

const PORT = parseInt(process.env.BACKEND_PORT || process.env.PORT || "", 10);

const { app } = await createApp();
app.listen(PORT, () => {
  console.info(`Listening on port ${PORT}`);
});
