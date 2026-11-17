# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_11_17_014538) do
  create_table "telemetries", force: :cascade do |t|
    t.string "hand"
    t.boolean "is_left"
    t.integer "battery"
    t.float "battery_voltage"
    t.boolean "charging_qi"
    t.integer "uptime_sec"
    t.integer "elbow_angle"
    t.integer "elbow_min"
    t.integer "elbow_max"
    t.integer "shoulder_angle"
    t.integer "shoulder_min"
    t.integer "shoulder_max"
    t.integer "phase_entry"
    t.integer "phase_pull"
    t.integer "phase_push"
    t.integer "force_n"
    t.integer "force_left"
    t.integer "force_right"
    t.integer "strokes"
    t.float "stroke_rate"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
  end
end
