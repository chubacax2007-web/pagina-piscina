Rails.application.routes.draw do
  post 'api/smartwatch/telemetry', to: 'api/v1/telemetries#create'
  get 'api/smartwatch/telemetry', to: 'api/v1/telemetries#index'
end