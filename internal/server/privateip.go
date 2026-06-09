package server

import (
	"fmt"
	"net"
	"net/http"
)

type privateNetworkInfo struct {
	IP         string `json:"ip"`
	Prefix     int    `json:"prefix"`
	SubnetMask string `json:"subnet_mask"`
	Gateway    string `json:"gateway"`
}

func (s *Server) handlePrivateIP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
		return
	}

	info, err := detectPrivateNetwork()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err)
		return
	}

	writeJSON(w, info)
}

func detectPrivateNetwork() (privateNetworkInfo, error) {
	ip, err := detectOutboundPrivateIPv4()
	if err != nil {
		return privateNetworkInfo{}, err
	}

	info := privateNetworkInfo{IP: ip.String()}
	if prefix, prefixErr := prefixLengthForIPv4(ip); prefixErr == nil {
		info.Prefix = prefix
		info.SubnetMask = subnetMaskFromPrefix(prefix)
	}
	if gateway, gatewayErr := detectDefaultGateway(ip.String()); gatewayErr == nil {
		info.Gateway = gateway
	}

	return info, nil
}

func detectOutboundPrivateIPv4() (net.IP, error) {
	conn, err := net.Dial("udp4", "8.8.8.8:80")
	if err != nil {
		return nil, fmt.Errorf("detect outbound adapter: %w", err)
	}
	defer conn.Close()

	if _, err := conn.Write([]byte{0}); err != nil {
		return nil, fmt.Errorf("bind outbound adapter: %w", err)
	}

	addr, ok := conn.LocalAddr().(*net.UDPAddr)
	if !ok || addr.IP == nil {
		return nil, fmt.Errorf("no local address on outbound adapter")
	}

	ip4 := addr.IP.To4()
	if ip4 == nil {
		return nil, fmt.Errorf("outbound adapter has no IPv4 address")
	}
	if !isPrivateIPv4(ip4) {
		return nil, fmt.Errorf("outbound adapter address is not private: %s", ip4.String())
	}

	return ip4, nil
}

func prefixLengthForIPv4(ip net.IP) (int, error) {
	ip4 := ip.To4()
	if ip4 == nil {
		return 0, fmt.Errorf("not an IPv4 address")
	}

	interfaces, err := net.Interfaces()
	if err != nil {
		return 0, fmt.Errorf("list interfaces: %w", err)
	}

	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok || ipNet.IP.To4() == nil {
				continue
			}
			if !ipNet.IP.Equal(ip4) {
				continue
			}
			ones, bits := ipNet.Mask.Size()
			if bits != 32 {
				continue
			}
			return ones, nil
		}
	}

	return 0, fmt.Errorf("no interface found for %s", ip4.String())
}

func subnetMaskFromPrefix(prefix int) string {
	if prefix <= 0 || prefix > 32 {
		return ""
	}
	mask := uint32(0xFFFFFFFF) << (32 - prefix)
	return fmt.Sprintf("%d.%d.%d.%d",
		byte(mask>>24),
		byte(mask>>16),
		byte(mask>>8),
		byte(mask),
	)
}

func isPrivateIPv4(ip net.IP) bool {
	ip = ip.To4()
	if ip == nil {
		return false
	}
	if ip[0] == 10 {
		return true
	}
	if ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31 {
		return true
	}
	if ip[0] == 192 && ip[1] == 168 {
		return true
	}
	return false
}
