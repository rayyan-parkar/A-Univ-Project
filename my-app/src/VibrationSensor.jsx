import {useState, useEffect} from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
);

function VibrationChart({latestData}) {
    const [signalData, setSignalData] = useState([]);

    //Generate an array from 0-100 to store the x-axis
    const time = Array.from({length: 101}, (_, i)=> i);

    useEffect(()=> {
        if (latestData!==null && latestData!==undefined) {
            setSignalData(prev=>{
                const newData = [...prev, parseFloat(latestData)];
                
                // Always keep exactly 100 points (sliding window)
                if (newData.length > 100) {
                    return newData.slice(-100);
                }
                
                // Fill remaining slots with 0 if we don't have 100 points yet
                while (newData.length < 100) {
                    newData.unshift(0); // Add zeros at the beginning
                }
                
                return newData;
            });
        }
    }, [latestData]);

    //Calculates Y-Axis Range
    const getRange = ()=> {

        //Default range of Y-Axis
        if (signalData.length===0) {
            return {min:-1, max:1};
        }
        
        // Filter out undefined and null values to ensure a smooth graph
        const validData = signalData.filter( val => val !== null && val!==undefined);
        let min = validData[0];
        let max = validData[0];

        for (let i = 1; i<validData.length; i++) {
            if (validData[i]>max) {
                max = validData[i];
            }  

            if (validData[i]<min) {
                min = validData[i];
            }
        }

        return {min: min, max: max};
    };

    const yRange = getRange();

    const chartData = {
        labels: time,
        datasets: [
            {
                label: 'Vibration Signal',
                data: signalData,
                fill: false,
                borderColor: '#0066ff',
                borderWidth: 2,
                pointRadius: 0,
            }
        ],
    };

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            title: {
                display: true,
                text: 'Vibration Signal',
                color: '#000000',
            },
        },

        scales: {
            x: {
                type: 'linear',
                min: 0,
                max: 100,
                title: {
                    display: true,
                    text: 'Time',
                    color: '#000000', 
                },
                ticks: {
                    stepSize: 10,
                    color: '#000000',
                },
            },

            y: {
                min: yRange.min,
                max: yRange.max,
                title: {
                    display: true,
                    text: 'Signal',
                    color: '#000000',
                },
                ticks: {
                    color: '#000000',
                    callback: function(value) {
                        return value.toFixed(1);
                    }
                },
                grid: {
                    zeroLineColor: '#000000',
                    zerLineWidth: 2,
                }
            },
        },

        animation: {
            duration: 0,
            loop: false,
            delay: 0,
            easing: 'easeInOutQuart',
        }
    };
    return (
        <div className='vibration-chart'>
            <Line data= {chartData} options = {chartOptions} />
        </div>
    );
}

export default VibrationChart;