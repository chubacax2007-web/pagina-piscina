Rails.application.routes.draw do
  root "dashboard#index"
  get  "raw_data",          to: "dashboard#raw_data"
  get  "datos_crudos.html", to: redirect("/raw_data")

  get  "api/athletes",             to: "api/v1/telemetries#athletes"
  get  "api/sessions",             to: "api/v1/telemetries#sessions"
  get  "api/admin/users",          to: "api/v1/telemetries#admin_users"
  post "api/register",             to: "api/v1/telemetries#register"
  post "api/login",                to: "api/v1/telemetries#login"
  post "api/recover",              to: "api/v1/telemetries#recover"

  get  "api/session/status",       to: "api/v1/telemetries#session_status"
  post "api/session/start",        to: "api/v1/telemetries#session_start"
  post "api/session/stop",         to: "api/v1/telemetries#session_stop"

  get  "api/activities/:athlete",  to: "api/v1/telemetries#activities"
  post "api/activities/add",       to: "api/v1/telemetries#add_activity"

  post "api/smartwatch/telemetry", to: "api/v1/telemetries#create"
  get  "api/smartwatch/telemetry", to: "api/v1/telemetries#index"
  get  "api/smartwatch/status",    to: "api/v1/telemetries#smartwatch_status"

  post "api/pool_pad/touch",       to: "api/v1/telemetries#pool_pad_touch"
end
