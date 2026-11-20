class EnableTimescaledbAndHypertable < ActiveRecord::Migration[7.0]
  def up
    # 1. Activa la extensión TimescaleDB en PostgreSQL de Render
    execute "CREATE EXTENSION IF NOT EXISTS timescaledb;"

    if table_exists?(:telemetries)
      # 2. Garantiza que created_at nunca sea nulo
      execute "UPDATE telemetries SET created_at = NOW() WHERE created_at IS NULL;"
      change_column_null :telemetries, :created_at, false

      # 3. TimescaleDB exige que la llave primaria incluya la columna de tiempo (created_at)
      execute "ALTER TABLE telemetries DROP CONSTRAINT IF EXISTS telemetries_pkey;"
      execute "ALTER TABLE telemetries ADD PRIMARY KEY (id, created_at);"

      # 4. Convierte la tabla telemetries en una Hypertable particionada por día
      execute <<~SQL
        SELECT create_hypertable(
          'telemetries',
          'created_at',
          chunk_time_interval => INTERVAL '1 day',
          migrate_data => true,
          if_not_exists => true
        );
      SQL
    end
  end

  def down
    # No se revierte automáticamente para proteger los registros guardados
  end
end
