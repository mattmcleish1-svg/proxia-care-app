'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

export type TempPoint = {
  time: string
  living_room: number | null
  bathroom: number | null
}

interface Props {
  data: TempPoint[]
}

export default function TemperatureTrend({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e8f4f3" vertical={false} />
        <XAxis
          dataKey="time"
          tick={{ fontSize: 11, fill: '#5a7975' }}
          tickLine={false}
          axisLine={false}
          interval={3}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#5a7975' }}
          tickLine={false}
          axisLine={false}
          domain={['dataMin - 1', 'dataMax + 1']}
          tickFormatter={(v) => `${v}°`}
        />
        <Tooltip
          formatter={(value) => [`${value}°F`]}
          contentStyle={{ borderRadius: 8, border: '1px solid #d1ebe8', fontSize: 12 }}
          cursor={{ stroke: '#5BBFB5', strokeWidth: 1, strokeDasharray: '4 4' }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          formatter={(value) => value === 'living_room' ? 'Living Room' : 'Bathroom'}
        />
        <Line
          type="monotone"
          dataKey="living_room"
          name="living_room"
          stroke="#5BBFB5"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="bathroom"
          name="bathroom"
          stroke="#F07C6B"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
