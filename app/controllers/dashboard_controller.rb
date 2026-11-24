class DashboardController < ApplicationController
  def index
  end

  def raw_data
    @telemetries = if defined?(Telemetry)
                     Telemetry.order(created_at: :desc).limit(200)
                   else
                     []
                   end
  rescue => e
    Rails.logger.warn("[DashboardController#raw_data] #{e.message}")
    @telemetries = []
  end
end
