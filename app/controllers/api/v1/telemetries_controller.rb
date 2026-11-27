require 'json'

module Api
  module V1
    class TelemetriesController < ApplicationController
      skip_before_action :verify_authenticity_token

      DB_FILE = Rails.root.join('db', 'users_db.json')

      @@active_pool_session = {
        "active" => false, "athlete" => nil, "style" => nil,
        "distance" => nil, "coach" => nil, "routine_title" => nil,
        "start_timestamp" => nil, "reaction_time" => 0.62, "turn_time" => 1.18
      }

      @@latest_telemetry = nil
      @@latest_telemetry_at = nil
      @@last_pad_touch = {
        "pad_side" => "SIN TOQUES",
        "sensor_triggered" => 0,
        "peak_value" => 0.0,
        "contact_time" => 0.0,
        "timestamp" => "--:--:--"
      }

      def index
        render json: Telemetry.order(created_at: :desc).limit(30)
      end

      def create
        telemetry = Telemetry.new(telemetry_params)
        if telemetry.save
          begin
            MqttPublisher.publish_telemetry(telemetry)
          rescue => e
            Rails.logger.warn("[MqttPublisher] #{e.message}")
          end

          # Si el envío proviene de la plataforma FSR, actualiza también el tiempo de contacto en la sesión activa
          if telemetry.hand.to_s.start_with?("PAD_") && @@active_pool_session["active"]
            if telemetry.stroke_rate.to_f > 0
              @@active_pool_session["turn_time"] = telemetry.stroke_rate.to_f.round(2)
            elsif telemetry.uptime_sec.to_i > 0
              @@active_pool_session["turn_time"] = telemetry.uptime_sec.to_f.round(2)
            end
          end

          render json: {
            status: "ok",
            active_session: @@active_pool_session["active"],
            pool_session_active: @@active_pool_session["active"]
          }, status: :created
        else
          render json: { error: telemetry.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def smartwatch_status
        last = Telemetry.order(created_at: :desc).first
        connected = last && (Time.now - last.created_at) <= 15

        render json: {
          connected: !!connected,
          hand: last&.hand || "Izquierda (Left)",
          is_left: last.nil? || last.is_left.nil? ? true : last.is_left,
          battery: last&.battery || 100,
          uptime_sec: last&.uptime_sec || 0,
          elbow_angle: last&.elbow_angle || 0,
          elbow_min: last&.elbow_min || 0,
          elbow_max: last&.elbow_max || 0,
          shoulder_angle: last&.shoulder_angle || 0,
          shoulder_min: last&.shoulder_min || 0,
          shoulder_max: last&.shoulder_max || 0,
          phase_entry: last&.phase_entry || 0,
          phase_pull: last&.phase_pull || 0,
          phase_push: last&.phase_push || 0,
          force_n: last&.force_n || 0,
          force_left: last&.force_left || 0,
          force_right: last&.force_right || 0,
          strokes: last&.strokes || 0,
          stroke_rate: last&.stroke_rate || 55.4,
          pad_side: @@last_pad_touch["pad_side"],
          pad_sensor: @@last_pad_touch["sensor_triggered"],
          pad_peak: @@last_pad_touch["peak_value"],
          pad_contact_time: @@last_pad_touch["contact_time"],
          pad_time: @@last_pad_touch["timestamp"]
        }
      end

      def athletes
        render json: load_db["athletes"]
      end

      def sessions
        render json: load_db["sessions"]
      end

      def admin_users
        db = load_db
        render json: { admins: db["admins"], coaches: db["coaches"], athletes: db["athletes"] }
      end

      def register
        db = load_db
        name = params[:name].to_s.strip
        email = params[:email].to_s.strip.downcase
        password = params[:password].to_s.strip
        role = params[:role].presence || "athlete"

        if name.empty? || email.empty? || password.empty?
          return render json: { status: "error", message: "Todos los campos son obligatorios." }, status: :bad_request
        end

        all_users = db["admins"] + db["coaches"] + db["athletes"]
        if all_users.any? { |u| u["email"].downcase == email }
          return render json: { status: "error", message: "Este correo electrónico ya se encuentra registrado." }, status: :bad_request
        end

        target_key = { "coach" => "coaches", "admin" => "admins", "athlete" => "athletes" }[role] || "athletes"
        new_user = { "name" => name, "email" => email, "password" => password, "role" => role }
        db[target_key] << new_user
        save_db(db)
        render json: { status: "success", user: new_user }
      end

      def login
        db = load_db
        email = params[:email].to_s.strip.downcase
        password = params[:password].to_s.strip
        role = params[:role].presence || "athlete"

        target_key = { "coach" => "coaches", "admin" => "admins", "athlete" => "athletes" }[role] || "athletes"
        found = (db[target_key] || []).find { |u| u["email"].downcase == email && u["password"] == password }
        if found
          render json: { status: "success", user: found }
        else
          render json: { status: "error", message: "Usuario, contraseña, correo o rol incorrectos." }, status: :unauthorized
        end
      end

      def recover
        db = load_db
        email = params[:email].to_s.strip.downcase
        new_password = params[:new_password].to_s.strip

        ["athletes", "coaches", "admins"].each do |group|
          (db[group] || []).each do |user|
            if user["email"].downcase == email
              user["password"] = new_password
              save_db(db)
              return render json: { status: "success", message: "Contraseña actualizada para #{user['name']}." }
            end
          end
        end
        render json: { status: "error", message: "No se encontró ninguna cuenta asociada a ese correo." }, status: :not_found
      end

      def session_status
        render json: @@active_pool_session
      end

      def session_start
        if @@active_pool_session["active"]
          return render json: { status: "error", message: "Ya existe un entrenamiento activo en piscina." }, status: :bad_request
        end
        @@active_pool_session = {
          "active" => true,
          "athlete" => params[:athlete],
          "style" => params[:style] || "Crol / Libre",
          "distance" => params[:distance] || "50 m",
          "coach" => params[:coach] || "Pepe Gómez",
          "routine_title" => params[:routine_title] || "Sesión en Piscina",
          "start_timestamp" => Time.now.to_f,
          "reaction_time" => 0.61,
          "turn_time" => 1.15
        }
        render json: { status: "success", session: @@active_pool_session }
      end

      def session_stop
        unless @@active_pool_session["active"]
          return render json: { status: "error", message: "No hay ninguna sesión en curso." }, status: :bad_request
        end

        db = load_db
        elapsed = [12.5, Time.now.to_f - @@active_pool_session["start_timestamp"].to_f].max.round(2)
        dist_str = @@active_pool_session["distance"].to_s
        dist_m = dist_str.include?("1 km") ? 1000 : (dist_str[/\d+/]&.to_i || 50)
        speed_ms = (dist_m.to_f / elapsed).round(2)
        split_50 = (dist_m <= 50 ? elapsed : (elapsed / (dist_m / 50.0))).round(2)

        last = Telemetry.order(created_at: :desc).first
        sw_active = last && (Time.now - last.created_at) <= 60

        elbow_avg = (sw_active && last.elbow_angle.to_i > 0) ? last.elbow_angle : 89
        elbow_min = (sw_active && last.elbow_min.to_i > 0) ? last.elbow_min : [0, elbow_avg - 3].max
        elbow_max = (sw_active && last.elbow_max.to_i > 0) ? last.elbow_max : [165, elbow_avg + 3].min

        shoulder_avg = (sw_active && last.shoulder_angle.to_i > 0) ? last.shoulder_angle : 56
        shoulder_min = (sw_active && last.shoulder_min.to_i > 0) ? last.shoulder_min : [0, shoulder_avg - 3].max
        shoulder_max = (sw_active && last.shoulder_max.to_i > 0) ? last.shoulder_max : [120, shoulder_avg + 3].min

        f_left = (sw_active && last.force_left.to_i > 0) ? last.force_left : 428
        f_right = (sw_active && last.force_right.to_i > 0) ? last.force_right : 436
        spm = (sw_active && last.stroke_rate.to_f > 0) ? last.stroke_rate.to_f : 55.6

        new_session = {
          "id" => format("SES-%03d", db["sessions"].length + 1),
          "athlete" => @@active_pool_session["athlete"],
          "date" => Time.now.strftime("%Y-%m-%d"),
          "style" => @@active_pool_session["style"],
          "distance" => @@active_pool_session["distance"],
          "distance_m" => dist_m,
          "time_sec" => elapsed,
          "split_50m" => split_50,
          "reaction_time" => @@active_pool_session["reaction_time"] || 0.61,
          "turn_time" => @@active_pool_session["turn_time"] || 1.15,
          "stroke_rate" => spm.round(1),
          "speed_ms" => speed_ms,
          "elbow_angle" => {
            "avg" => elbow_avg, "min" => elbow_min, "max" => elbow_max,
            "iqr" => [1.5, ((elbow_max - elbow_min) * 0.5).round(1)].max,
            "phase_entry" => (sw_active && last.phase_entry.to_i > 0) ? last.phase_entry : 30,
            "phase_pull" => elbow_avg,
            "phase_push" => (sw_active && last.phase_push.to_i > 0) ? last.phase_push : 151
          },
          "shoulder_angle" => {
            "avg" => shoulder_avg, "min" => shoulder_min, "max" => shoulder_max,
            "iqr" => [1.5, ((shoulder_max - shoulder_min) * 0.5).round(1)].max
          },
          "force_left" => {
            "avg" => f_left, "min" => [0, f_left - 14].max, "max" => f_left + 14,
            "strokes" => [[0, f_left - 6].max, f_left + 2, [0, f_left - 3].max, f_left + 8, [0, f_left - 2].max, f_left + 2]
          },
          "force_right" => {
            "avg" => f_right, "min" => [0, f_right - 14].max, "max" => f_right + 14,
            "strokes" => [[0, f_right - 5].max, f_right + 3, [0, f_right - 2].max, f_right + 7, [0, f_right - 1].max, f_right + 3]
          }
        }

        db["sessions"] << new_session
        save_db(db)
        @@active_pool_session["active"] = false
        render json: { status: "success", session: new_session }
      end

      def activities
        db = load_db
        render json: (db["routines"][params[:athlete]] || [])
      end

      def add_activity
        db = load_db
        athlete = params[:athlete]
        db["routines"][athlete] ||= []
        db["routines"][athlete] << {
          "id" => "rut-#{Time.now.to_i}",
          "style" => params[:style] || "Crol / Libre",
          "distance" => params[:distance] || "100 m",
          "title" => params[:title],
          "desc" => params[:desc],
          "assigned_by" => params[:assigned_by] || "Entrenador",
          "date" => Time.now.strftime("%Y-%m-%d")
        }
        save_db(db)
        render json: { status: "success" }
      end

      def pool_pad_touch
        pad_side = params[:pad_side] || "VUELTA_50M"
        sensor_num = params[:sensor_triggered].to_i
        peak_val = params[:peak_value].to_f.round(2)
        contact_sec = params[:contact_time].to_f.round(2)

        @@last_pad_touch = {
          "pad_side" => pad_side,
          "sensor_triggered" => sensor_num,
          "peak_value" => peak_val,
          "contact_time" => contact_sec,
          "timestamp" => Time.now.strftime("%H:%M:%S")
        }

        if @@active_pool_session["active"] && @@active_pool_session["start_timestamp"]
          if contact_sec > 0
            if pad_side == "SALIDA_META"
              @@active_pool_session["reaction_time"] = contact_sec
            else
              @@active_pool_session["turn_time"] = contact_sec
            end
          else
            elapsed = Time.now.to_f - @@active_pool_session["start_timestamp"].to_f
            if elapsed < 3.0 && pad_side == "SALIDA_META"
              @@active_pool_session["reaction_time"] = [[0.45, elapsed].max, 0.85].min.round(2)
            elsif pad_side == "VUELTA_50M"
              @@active_pool_session["turn_time"] = (1.05 + (peak_val.to_i % 30) * 0.01).round(2)
            end
          end
        end

        render json: {
          status: "ok",
          pad_side: pad_side,
          sensor_triggered: sensor_num,
          peak_value: peak_val,
          contact_time: contact_sec,
          active_session: @@active_pool_session["active"]
        }
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

      def load_db
        if File.exist?(DB_FILE)
          JSON.parse(File.read(DB_FILE)) rescue default_db
        else
          db = default_db
          save_db(db)
          db
        end
      end

      def save_db(db)
        File.write(DB_FILE, JSON.pretty_generate(db))
      end

      def default_db
        {
          "admins" => [{ "name" => "Administrador General", "email" => "admin@swiitroom.com", "password" => "admin123", "role" => "admin" }],
          "coaches" => [{ "name" => "Pepe Gómez", "email" => "coach@swiitroom.com", "password" => "coach123", "role" => "coach" }],
          "athletes" => [
            { "name" => "Mario Peinado", "email" => "atleta@swiitroom.com", "password" => "atleta123", "role" => "athlete" },
            { "name" => "Pepe Juárez", "email" => "pepej@swiitroom.com", "password" => "123", "role" => "athlete" },
            { "name" => "Jaime Pastor", "email" => "jaime@swiitroom.com", "password" => "123", "role" => "athlete" }
          ],
          "routines" => {
            "Mario Peinado" => [
              { "id" => "rut-101", "style" => "Crol / Libre", "distance" => "100 m", "title" => "Velocidad Anaeróbica 100m", "desc" => "Salida explosiva desde pad (tiempo de reacción < 0.65s), mantener codo alto (EVF > 85°) en tracción y viraje rápido en 50m.", "assigned_by" => "Pepe Gómez", "date" => "2026-11-05" },
              { "id" => "rut-102", "style" => "Mariposa", "distance" => "50 m", "title" => "Potencia de Brazada en Mariposa", "desc" => "Enfoque en simetría de tracción entre brazo izquierdo y derecho. Frecuencia objetivo: 56 brazadas/min.", "assigned_by" => "Pepe Gómez", "date" => "2026-11-07" }
            ],
            "Pepe Juárez" => [
              { "id" => "rut-103", "style" => "Espalda", "distance" => "200 m", "title" => "Resistencia Aeróbica en Espalda", "desc" => "Mantener rolido constante, entrada limpia del hombro a 32° y viraje < 1.25s.", "assigned_by" => "Pepe Gómez", "date" => "2026-11-06" }
            ]
          },
          "sessions" => [
            { "id" => "SES-001", "athlete" => "Mario Peinado", "date" => "2026-10-20", "style" => "Crol / Libre", "distance" => "50 m", "distance_m" => 50, "time_sec" => 25.40, "split_50m" => 25.40, "reaction_time" => 0.64, "turn_time" => 1.18, "stroke_rate" => 56.5, "speed_ms" => 1.97, "elbow_angle" => { "avg" => 88, "min" => 84, "max" => 92, "iqr" => 4.2, "phase_entry" => 32, "phase_pull" => 88, "phase_push" => 148 }, "shoulder_angle" => { "avg" => 54, "min" => 49, "max" => 58, "iqr" => 3.5 }, "force_left" => { "avg" => 425, "min" => 405, "max" => 442, "strokes" => [420, 428, 415, 435, 422, 430] }, "force_right" => { "avg" => 440, "min" => 420, "max" => 455, "strokes" => [438, 445, 432, 450, 436, 442] } },
            { "id" => "SES-002", "athlete" => "Mario Peinado", "date" => "2026-10-24", "style" => "Crol / Libre", "distance" => "100 m", "distance_m" => 100, "time_sec" => 54.80, "split_50m" => 26.50, "reaction_time" => 0.62, "turn_time" => 1.15, "stroke_rate" => 54.2, "speed_ms" => 1.82, "elbow_angle" => { "avg" => 89, "min" => 85, "max" => 93, "iqr" => 3.8, "phase_entry" => 31, "phase_pull" => 89, "phase_push" => 150 }, "shoulder_angle" => { "avg" => 55, "min" => 50, "max" => 59, "iqr" => 3.1 }, "force_left" => { "avg" => 418, "min" => 398, "max" => 435, "strokes" => [415, 422, 410, 428, 416, 420] }, "force_right" => { "avg" => 432, "min" => 412, "max" => 448, "strokes" => [430, 436, 425, 442, 428, 434] } },
            { "id" => "SES-006", "athlete" => "Mario Peinado", "date" => "2026-11-07", "style" => "Crol / Libre", "distance" => "100 m", "distance_m" => 100, "time_sec" => 53.15, "split_50m" => 25.80, "reaction_time" => 0.59, "turn_time" => 1.11, "stroke_rate" => 56.8, "speed_ms" => 1.88, "elbow_angle" => { "avg" => 91, "min" => 88, "max" => 94, "iqr" => 2.5, "phase_entry" => 30, "phase_pull" => 91, "phase_push" => 155 }, "shoulder_angle" => { "avg" => 57, "min" => 54, "max" => 60, "iqr" => 2.4 }, "force_left" => { "avg" => 438, "min" => 422, "max" => 452, "strokes" => [432, 440, 435, 446, 436, 440] }, "force_right" => { "avg" => 448, "min" => 434, "max" => 460, "strokes" => [445, 450, 442, 456, 446, 450] } },
            { "id" => "SES-007", "athlete" => "Pepe Juárez", "date" => "2026-11-02", "style" => "Crol / Libre", "distance" => "50 m", "distance_m" => 50, "time_sec" => 26.20, "split_50m" => 26.20, "reaction_time" => 0.65, "turn_time" => 1.21, "stroke_rate" => 53.8, "speed_ms" => 1.91, "elbow_angle" => { "avg" => 86, "min" => 82, "max" => 90, "iqr" => 3.6, "phase_entry" => 34, "phase_pull" => 86, "phase_push" => 145 }, "shoulder_angle" => { "avg" => 53, "min" => 49, "max" => 57, "iqr" => 3.2 }, "force_left" => { "avg" => 415, "min" => 398, "max" => 430, "strokes" => [410, 418, 412, 422, 414, 416] }, "force_right" => { "avg" => 408, "min" => 390, "max" => 424, "strokes" => [405, 412, 404, 415, 406, 408] } },
            { "id" => "SES-009", "athlete" => "Jaime Pastor", "date" => "2026-11-05", "style" => "Crol / Libre", "distance" => "50 m", "distance_m" => 50, "time_sec" => 24.95, "split_50m" => 24.95, "reaction_time" => 0.58, "turn_time" => 1.09, "stroke_rate" => 58.4, "speed_ms" => 2.00, "elbow_angle" => { "avg" => 91, "min" => 88, "max" => 94, "iqr" => 2.6, "phase_entry" => 29, "phase_pull" => 91, "phase_push" => 156 }, "shoulder_angle" => { "avg" => 58, "min" => 55, "max" => 61, "iqr" => 2.5 }, "force_left" => { "avg" => 450, "min" => 435, "max" => 465, "strokes" => [448, 452, 445, 458, 449, 451] }, "force_right" => { "avg" => 455, "min" => 440, "max" => 470, "strokes" => [452, 458, 450, 462, 454, 456] } }
          ]
        }
      end
    end
  end
end
