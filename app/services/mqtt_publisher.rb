require "mqtt"
require "json"
require "timeout"

class MqttPublisher
  def self.publish_telemetry(record)
    # Se ejecuta en un hilo separado para nunca demorar ni tumbar la respuesta al ESP32
    Thread.new do
      Timeout.timeout(3) do
        host     = ENV.fetch("MQTT_HOST", "broker.hivemq.com")
        port     = ENV.fetch("MQTT_PORT", "1883").to_i
        username = ENV["MQTT_USERNAME"]
        password = ENV["MQTT_PASSWORD"]
        use_ssl  = ENV.fetch("MQTT_SSL", "false") == "true"
        prefix   = ENV.fetch("MQTT_PREFIX", "swiitroom_vela")

        options = { host: host, port: port, ssl: use_ssl }
        if username.present?
          options[:username] = username
          options[:password] = password
        end

        es_pad = record.hand.to_s.upcase.start_with?("PAD_")
        base   = es_pad ? "#{prefix}/pool_pad" : "#{prefix}/smartwatch"

        payload_completo = {
          id: record.id,
          timestamp: record.created_at,
          hand: record.hand,
          elbow_angle: record.try(:elbow_angle),
          wrist_angle: record.try(:shoulder_angle),
          force_n: record.try(:force_n),
          stroke_rate: record.try(:stroke_rate),
          battery: record.try(:battery)
        }

        MQTT::Client.connect(options) do |client|
          client.publish("#{base}/raw_json", payload_completo.to_json, retain: true)
          client.publish("#{base}/force_n", record.try(:force_n).to_s, retain: true)
          client.publish("#{base}/hand", record.hand.to_s, retain: true)

          if es_pad
            client.publish("#{base}/contact_time_s", record.try(:stroke_rate).to_s, retain: true)
          else
            client.publish("#{base}/angles/elbow_deg", record.try(:elbow_angle).to_s, retain: true)
            client.publish("#{base}/angles/wrist_deg", record.try(:shoulder_angle).to_s, retain: true)
            client.publish("#{base}/metrics/stroke_rate_spm", record.try(:stroke_rate).to_s, retain: true)
            client.publish("#{base}/battery_pct", record.try(:battery).to_s, retain: true)
          end
        end
      end
    rescue => e
      Rails.logger.warn("[MQTT] No se pudo publicar: #{e.message}")
    end
  end
end
