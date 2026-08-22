import app from '../server/app';

// The application boundary shared by fetch-native runtimes. The framework
// consumes and produces Web Platform Request/Response values; runtimes only
// decide how this handler is hosted.
export const fetchHandler = app.fetch;

export default fetchHandler;
