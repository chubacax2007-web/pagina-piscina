class CreateTelemetries < ActiveRecord::Migration[8.1]
  def change
    create_table :telemetries do |t|
      t.string :hand
      t.boolean :is_left
      t.integer :battery
      t.float :battery_voltage
      t.boolean :charging_qi
      t.integer :uptime_sec
      t.integer :elbow_angle
      t.integer :elbow_min
      t.integer :elbow_max
      t.integer :shoulder_angle
      t.integer :shoulder_min
      t.integer :shoulder_max
      t.integer :phase_entry
      t.integer :phase_pull
      t.integer :phase_push
      t.integer :force_n
      t.integer :force_left
      t.integer :force_right
      t.integer :strokes
      t.float :stroke_rate

      t.timestamps
    end
  end
end
