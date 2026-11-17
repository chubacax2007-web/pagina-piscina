module Api
  module V1
    class TelemetriesController < ApplicationController
      def index
        render json: Telemetry.order(created_at: :desc).limit(20)
      end

      def create
        telemetry = Telemetry.new(telemetry_params)

        if telemetry.save
          render json: { status: "success", pool_session_active: true }, status: :created
        else
          render json: { error: telemetry.errors.full_messages }, status: :unprocessable_entity
        end
      end

      private

      def telemetry_params
        params.fetch(:telemetry, params).permit(
          :hand, :is_left, :battery, :battery_voltage, :charging_qi, 
          :uptime_sec, :elbow_angle, :elbow_min, :elbow_max, 
          :shoulder_angle, :shoulder_min, :shoulder_max, 
          :phase_entry, :phase_pull, :phase_push, 
          :force_n, :force_left, :force_right, 
          :strokes, :stroke_rate
        )
      end
    end
  end
end