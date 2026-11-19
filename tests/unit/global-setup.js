// Pin the timezone so date-formatting assertions behave the same on every machine and in CI.
export default function setup() {
  process.env.TZ = "UTC";
}
