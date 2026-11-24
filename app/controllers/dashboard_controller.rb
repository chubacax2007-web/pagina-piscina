class DashboardController < ApplicationController
  def index
    # Aquí Rails pasa los datos iniciales a la vista ERB (atletas, sesiones, estado)
  end

  def raw_data
    @telemetries = Telemetry.order(created_at: :desc).limit(200)
  end
end
